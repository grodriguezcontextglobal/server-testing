'use strict';

/**
 * Regresión: el refund fallaba con CUALQUIER payload.
 *
 * El validador (validateRefundPayload) aceptaba `payment_intent` /
 * `paymentIntentId` y el controlador leía `paymentIntent`. Los tests de cada
 * pieza pasaban por separado; el fallo solo se ve al encadenarlas. Por eso este
 * test corre validador + controlador y mira lo que llega a stripe.refunds.create.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const refundCalls = [];
stub('helpers/stripeClient.js', {
  stripe: {
    refunds: {
      create: async (params) => {
        refundCalls.push(params);
        return { id: 're_1', ...params };
      },
    },
  },
  runStripeMutation: (fn) => fn(),
});

const { validateRefundPayload } = require('../middlewares/validateStripeRoutePayload');
const {
  refundStripePaymentIntent,
  partialRefundStripePaymentIntent,
} = require('../controller/stripe');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function chain(controller, body) {
  const req = { body: { ...body } };
  const res = mockRes();
  let passed = false;
  validateRefundPayload(req, res, () => { passed = true; });
  if (passed) await controller(req, res);
  return res;
}

const PI = 'pi_3UMEiCJAluu3aB960UpiiYL6';

for (const key of ['paymentIntent', 'payment_intent', 'paymentIntentId']) {
  test(`refund con \`${key}\`: llega a Stripe como payment_intent`, async () => {
    refundCalls.length = 0;
    const res = await chain(refundStripePaymentIntent, { [key]: PI });
    assert.equal(res.statusCode, 201);
    assert.equal(refundCalls.length, 1);
    assert.equal(refundCalls[0].payment_intent, PI);
  });
}

test('refund parcial con paymentIntent y total: payment_intent y amount en centavos', async () => {
  refundCalls.length = 0;
  const res = await chain(partialRefundStripePaymentIntent, { paymentIntent: PI, total: 12.5 });
  assert.equal(res.statusCode, 201);
  assert.equal(refundCalls[0].payment_intent, PI);
  assert.equal(refundCalls[0].amount, 1250);
});

test('un id inválido no llega a Stripe', async () => {
  refundCalls.length = 0;
  const res = await chain(refundStripePaymentIntent, { paymentIntent: 'nope' });
  assert.equal(res.statusCode, 422);
  assert.equal(refundCalls.length, 0);
});
