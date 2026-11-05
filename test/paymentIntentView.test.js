'use strict';

/**
 * GET /api/stripe/payment_intents/:id (2026-10-16).
 *
 * - Desde la API 2022-11-15 el PaymentIntent no trae `charges`, y la app y el
 *   dashboard leían de ahí la tarjeta y el recibo: se veía "XXXX" y ningún
 *   recibo. Ahora se expande `latest_charge` y se rellena `charges.data[0]`.
 * - Sin sesión ya no va el objeto entero (client_secret, cliente, metadata).
 * - Con un id de 15 o menos el handler no respondía (408): ahora 400.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const STAFF = '111111111111111111111111';
stub('models/AdminUser.js', {
  findById: (id) => ({
    select: () => ({ lean: async () => (id === STAFF ? { tokenVersion: 3, active: true } : null) }),
  }),
});

const retrieveCalls = [];
let stripeBehaviour = null;
stub('helpers/stripeClient.js', {
  stripe: {
    paymentIntents: {
      retrieve: async (id, opts) => {
        retrieveCalls.push({ id, opts });
        return stripeBehaviour(id);
      },
    },
  },
  runStripeMutation: (fn) => fn(),
});
stub('helpers/logger.js', { error: () => {}, warn: () => {}, info: () => {} });

const { staffView, publicView, isRetrievableId } = require('../helpers/paymentIntentView');
const { retrievePaymentIntent } = require('../controller/stripe');

const ID = 'pi_3PqXyZ2eZvKYlo2C0abcdEFG';
// Lo que devuelve Stripe hoy con expand: ['latest_charge']: sin `charges`.
const stripePI = () => ({
  id: ID,
  object: 'payment_intent',
  status: 'requires_capture',
  amount: 5000,
  amount_capturable: 5000,
  currency: 'usd',
  client_secret: 'pi_secret_SHOULD_NOT_LEAK',
  customer: 'cus_123',
  metadata: { company_id: 'C1' },
  latest_charge: {
    id: 'ch_1',
    receipt_url: 'https://pay.stripe.com/receipts/abc',
    payment_method_details: { card: { last4: '4242', network: 'visa', brand: 'visa', exp_month: 12 } },
  },
});

const withOrigin = (origin) => ({ header: (n) => (n.toLowerCase() === 'origin' ? origin : undefined) });
const staffReq = (id = ID) => ({ params: { id }, uid: STAFF, tokenVersion: 3, ...withOrigin('https://admin.devitrak.net') });
const appReq = (id = ID) => ({ params: { id }, ...withOrigin('https://app.devitrak.net') });
const dashboardNoSession = (id = ID) => ({ params: { id }, ...withOrigin('https://admin.devitrak.net') });
const res = () => {
  const r = {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const call = async (request) => { const r = res(); await retrievePaymentIntent(request, r); return r; };

// ── vistas ──────────────────────────────────────────────────────────────────

test('publicView: lo que lee la app vuelve a estar, en la forma vieja y en la plana', () => {
  const v = publicView(stripePI());
  // forma vieja (versión actual de la app)
  assert.equal(v.id, ID);
  assert.equal(v.amount_capturable, 5000);
  assert.equal(v.charges.data[0].payment_method_details.card.last4, '4242');
  assert.equal(v.charges.data[0].payment_method_details.card.network, 'visa');
  assert.equal(v.charges.data[0].receipt_url, 'https://pay.stripe.com/receipts/abc');
  // forma plana (Q4a)
  assert.deepEqual(
    { status: v.status, amount: v.amount, amountCapturable: v.amountCapturable, currency: v.currency, card: v.card, receiptUrl: v.receiptUrl },
    { status: 'requires_capture', amount: 5000, amountCapturable: 5000, currency: 'usd', card: { last4: '4242', network: 'visa' }, receiptUrl: 'https://pay.stripe.com/receipts/abc' },
  );
});

test('publicView: no lleva client_secret, cliente, metadata ni el cargo entero', () => {
  const v = publicView(stripePI());
  const json = JSON.stringify(v);
  for (const leak of ['client_secret', 'SHOULD_NOT_LEAK', 'cus_123', 'metadata', 'latest_charge', 'exp_month']) {
    assert.equal(json.includes(leak), false, leak);
  }
});

test('staffView: objeto entero + charges.data[0] compatible (lo que lee el dashboard)', () => {
  const v = staffView(stripePI());
  assert.equal(v.client_secret, 'pi_secret_SHOULD_NOT_LEAK', 'el staff sigue viendo todo');
  assert.equal(v.charges.data[0].payment_method_details.card.exp_month, 12);
  assert.equal(v.receiptUrl, 'https://pay.stripe.com/receipts/abc');
});

test('vistas: sin cargo todavía (no capturado) → card y recibo null, charges vacío', () => {
  const pi = { ...stripePI(), latest_charge: null };
  assert.deepEqual(publicView(pi).charges.data, []);
  assert.equal(publicView(pi).card, null);
  assert.deepEqual(staffView(pi).charges.data, []);
});

test('vistas: una API vieja que todavía trae charges se respeta', () => {
  const pi = { ...stripePI(), latest_charge: 'ch_1', charges: { data: [stripePI().latest_charge] } };
  assert.equal(publicView(pi).card.last4, '4242');
  assert.equal(staffView(pi).charges.data[0].id, 'ch_1');
});

test('isRetrievableId: 15 o menos no (los "pi_" + nanoid(12) de la app miden 15)', () => {
  assert.equal(isRetrievableId('pi_abcdefghijkl'), false);
  assert.equal(isRetrievableId(ID), true);
  assert.equal(isRetrievableId(undefined), false);
});

// ── controlador ─────────────────────────────────────────────────────────────

test('controlador: expande latest_charge', async () => {
  stripeBehaviour = () => stripePI();
  retrieveCalls.length = 0;
  await call(appReq());
  assert.deepEqual(retrieveCalls[0], { id: ID, opts: { expand: ['latest_charge'] } });
});

test('controlador: la app sin sesión recibe la vista recortada', async () => {
  stripeBehaviour = () => stripePI();
  const r = await call(appReq());
  assert.equal(r.code, 201);
  assert.equal(r.body.paymentIntent.client_secret, undefined);
  assert.equal(r.body.paymentIntent.card.last4, '4242');
});

test('controlador: el staff con sesión recibe el objeto entero', async () => {
  stripeBehaviour = () => stripePI();
  const r = await call(staffReq());
  assert.equal(r.code, 201);
  assert.equal(r.body.paymentIntent.client_secret, 'pi_secret_SHOULD_NOT_LEAK');
});

test('controlador: dashboard sin sesión → 401, sin llamar a Stripe', async () => {
  stripeBehaviour = () => stripePI();
  retrieveCalls.length = 0;
  const r = await call(dashboardNoSession());
  assert.equal(r.code, 401);
  assert.equal(retrieveCalls.length, 0);
});

test('controlador: id de 15 o menos → 400 (antes colgaba hasta el 408)', async () => {
  retrieveCalls.length = 0;
  const r = await call(appReq('pi_abcdefghijkl'));
  assert.equal(r.code, 400);
  assert.equal(retrieveCalls.length, 0);
});

test('controlador: el pago no existe en Stripe → 404 (antes 500)', async () => {
  stripeBehaviour = () => { const e = new Error('No such payment_intent'); e.code = 'resource_missing'; e.statusCode = 404; throw e; };
  const r = await call(appReq());
  assert.equal(r.code, 404);
});

test('controlador: otro error de Stripe → 500 sin volcar el error', async () => {
  stripeBehaviour = () => { throw Object.assign(new Error('boom'), { type: 'api_error', raw: { secret: 'x' } }); };
  const r = await call(appReq());
  assert.equal(r.code, 500);
  assert.equal(JSON.stringify(r.body).includes('secret'), false);
});
