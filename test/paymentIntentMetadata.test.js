'use strict';

// Stripe Fase 0.1b (2026-10-19): los tres PaymentIntent llevan la compañía en
// metadata. Antes, -customized y -subscription no: sus pagos quedaban sin dueño
// en Stripe.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const created = [];
stub('helpers/stripeClient.js', {
  stripe: { paymentIntents: { create: async (params) => { created.push(params); return { id: 'pi_x', client_secret: 's', amount: params.amount }; } } },
  runStripeMutation: (fn) => fn(),
});
stub('helpers/logger.js', { error: () => {}, warn: () => {}, info: () => {} });

const { stripePaymentIntentCustomized, stripePaymentIntentSubscription } = require('../controller/stripe');

const CO = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const req = (body, company) => {
  const headers = company ? { 'x-company-id': company } : {};
  return { body, headers, header: (n) => headers[n.toLowerCase()], query: {}, params: {} };
};
const res = () => { const r = {}; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

for (const [name, fn, body] of [
  ['create-payment-intent-customized', stripePaymentIntentCustomized, { receipt_email: 'a@b.com', total: 10 }],
  ['create-payment-intent-subscription', stripePaymentIntentSubscription, { customerEmail: 'a@b.com', total: 1000 }],
]) {
  test(`${name}: estampa metadata.company_id con la compañía del contexto`, async () => {
    created.length = 0;
    const r = res();
    await fn(req(body, CO), r);
    assert.equal(r.code, 201);
    assert.deepEqual(created[0].metadata, { company_id: CO });
  });

  test(`${name}: sin compañía en el contexto, sin metadata (como antes)`, async () => {
    created.length = 0;
    await fn(req(body), res());
    assert.equal(created[0].metadata, undefined);
  });
}
