'use strict';

/**
 * Recibo con QR firmado (2026-10-20). Antes, la página pública /receipt leía
 * GET /transaction?paymentIntent=…, que devolvía la transacción entera (nombre y
 * email) a quien conociera el id. Ahora el QR lleva un token que caduca al fin
 * del evento + 30 días, y la lectura pública solo da estado, importe,
 * dispositivos y evento.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const { receiptExpiry, signReceiptToken, readReceiptToken, MAX_TTL_S } = require('../helpers/receiptLinkToken');
const { createReceiptLinkHandlers, publicReceipt } = require('../controller/receiptLinkHandlers');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T12:00:00Z');
const CO_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CO_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const PI = 'pi_3RRRRRRRRRRRRRRRRRRRRRRRR';

const TX = {
  paymentIntent: PI,
  clientSecret: 'pi_secret_SHOULD_NOT_LEAK',
  company: CO_A,
  event_id: 'ev1',
  eventSelected: 'Science Fair',
  provider: 'Lincoln High',
  date: '2026-10-18',
  active: true,
  device: [{ deviceType: 'iPad', deviceNeeded: 2, deviceValue: 150 }, { deviceType: 'Charger', deviceNeeded: 1, deviceValue: 25.5 }],
  consumerInfo: { name: 'Ana', lastName: 'Diaz', email: 'ana@home.com', phoneNumber: '555-0100' },
};

// ── token ───────────────────────────────────────────────────────────────────

test('caduca al fin del evento + 30 días (si no hay fin, el inicio; si no hay nada, ahora)', () => {
  assert.equal(receiptExpiry({ dateEnd: '2026-11-01T00:00:00Z' }, NOW).toISOString(), new Date(Date.parse('2026-11-01T00:00:00Z') + 30 * DAY).toISOString());
  assert.equal(receiptExpiry({ dateBegin: '2026-10-25T00:00:00Z' }, NOW).toISOString(), new Date(Date.parse('2026-10-25T00:00:00Z') + 30 * DAY).toISOString());
  assert.equal(receiptExpiry({}, NOW).getTime(), NOW.getTime() + 30 * DAY);
  assert.equal(receiptExpiry({ dateEnd: 'basura' }, NOW).getTime(), NOW.getTime() + 30 * DAY);
});

test('evento terminado hace más de 30 días → no hay token', () => {
  assert.equal(signReceiptToken({ paymentIntent: PI, company: CO_A }, new Date(NOW.getTime() - DAY), NOW), null);
});

test('token válido se lee; manipulado o de otro propósito no', () => {
  const t = signReceiptToken({ paymentIntent: PI, company: CO_A }, new Date(Date.now() + 10 * DAY));
  assert.equal(readReceiptToken(t).pi, PI);
  assert.equal(readReceiptToken(t.slice(0, -2) + 'xx'), null);
  assert.equal(readReceiptToken(require('jsonwebtoken').sign({ purpose: 'event_attendance', pi: PI }, `${process.env.SECRET_JWT_SEED}:receipt_link`)), null);
  assert.equal(readReceiptToken(undefined), null);
});

test('tope duro de 400 días aunque el evento acabe dentro de 3 años', () => {
  const t = signReceiptToken({ paymentIntent: PI, company: CO_A }, new Date(Date.now() + 3 * 365 * DAY));
  const { iat, exp } = readReceiptToken(t);
  assert.ok(exp - iat <= MAX_TTL_S);
});

// ── vista pública ───────────────────────────────────────────────────────────

test('lo público: estado, importe, dispositivos y evento; ni email, ni teléfono, ni nombre, ni clientSecret', () => {
  const r = publicReceipt(TX);
  assert.equal(r.status, 'active');
  assert.equal(r.amount, 325.5);
  assert.equal(r.eventSelected, 'Science Fair');
  assert.equal(r.device.length, 2);
  const json = JSON.stringify(r);
  for (const leak of ['ana@home.com', '555-0100', 'Diaz', 'SHOULD_NOT_LEAK', 'consumerInfo']) assert.equal(json.includes(leak), false, leak);
  assert.equal(publicReceipt({ ...TX, active: false }).status, 'refunded');
});

// ── controladores ───────────────────────────────────────────────────────────

const finds = [];
const handlers = createReceiptLinkHandlers({
  Transaction: {
    findOne: (filter) => {
      finds.push(filter);
      const hit = filter.paymentIntent === PI && (!filter.company || filter.company === CO_A) ? TX : null;
      return { select: () => ({ lean: async () => hit }), lean: async () => hit };
    },
  },
  Event: { findById: () => ({ select: () => ({ lean: async () => ({ eventInfoDetail: { dateEnd: '2026-11-01T00:00:00Z' } }) }) }) },
  logger: { error: () => {}, warn: () => {}, info: () => {} },
  now: () => NOW,
});
const res = () => { const r = {}; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

test('emitir: devuelve token atado a la compañía dueña y la caducidad', async () => {
  const r = res();
  await handlers.issueReceiptLink({ body: { paymentIntent: PI }, paymentOwnership: { companyId: CO_A, owners: [CO_A] } }, r);
  assert.equal(r.code, 200);
  assert.equal(new Date(r.body.expiresAt).toISOString(), new Date(Date.parse('2026-11-01T00:00:00Z') + 30 * DAY).toISOString());
  assert.equal(readReceiptToken(r.body.token)?.company, CO_A);
});

test('emitir: el super_user de plataforma para otra compañía → el token lleva la compañía dueña', async () => {
  const r = res();
  await handlers.issueReceiptLink({ body: { paymentIntent: PI }, paymentOwnership: { companyId: CO_B, owners: [CO_A], platformSuperUser: true } }, r);
  assert.equal(readReceiptToken(r.body.token)?.company, CO_A);
});

test('leer: con el token del QR da la vista pública', async () => {
  const token = signReceiptToken({ paymentIntent: PI, company: CO_A }, new Date(Date.now() + DAY));
  const r = res();
  await handlers.getPublicReceipt({ query: { rt: token }, header: () => undefined }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.receipt.amount, 325.5);
  assert.equal(r.body.receipt.consumerInfo, undefined);
});

test('leer: sin token o con uno inválido → 401; token de otra compañía → 404', async () => {
  const r1 = res();
  await handlers.getPublicReceipt({ query: {}, header: () => undefined }, r1);
  assert.equal(r1.code, 401);
  const tokenB = signReceiptToken({ paymentIntent: PI, company: CO_B }, new Date(Date.now() + DAY));
  const r2 = res();
  await handlers.getPublicReceipt({ query: { rt: tokenB }, header: () => undefined }, r2);
  assert.equal(r2.code, 404);
});

// ── rutas ───────────────────────────────────────────────────────────────────

test('routes: receipt-link exige sesión y propiedad del pago; receipt es pública', () => {
  const { validateJWT } = require('../middlewares/validate-jwt');
  const router = require('../routes/transaction');
  const chain = (m, p) => router.stack.find((l) => l.route?.path === p && l.route.methods[m]).route.stack.map((l) => l.handle);
  const link = chain('post', '/receipt-link');
  assert.ok(link.includes(validateJWT));
  assert.ok(link.some((h) => h.toString().includes('defaultFactory')), 'requirePaymentOwnership');
  assert.equal(chain('get', '/receipt').includes(validateJWT), false);
});
