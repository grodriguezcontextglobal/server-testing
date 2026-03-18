const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validatePaymentIntentIdParam,
  validateRefundPayload,
} = require('../middlewares/validateStripeRoutePayload');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('validatePaymentIntentIdParam accepts Stripe payment intent id', () => {
  const req = { params: { id: 'pi_3Nabc123XYZ' } };
  const res = mockRes();
  let nextCalled = false;
  validatePaymentIntentIdParam(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('validatePaymentIntentIdParam rejects invalid id', () => {
  const req = { params: { id: 'bad_id' } };
  const res = mockRes();
  let nextCalled = false;
  validatePaymentIntentIdParam(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 422);
});

test('validateRefundPayload accepts payment_intent', () => {
  const req = { body: { payment_intent: 'pi_abc12345' } };
  const res = mockRes();
  let nextCalled = false;
  validateRefundPayload(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('validateRefundPayload rejects missing/invalid payload', () => {
  const req = { body: { payment_intent: '123' } };
  const res = mockRes();
  let nextCalled = false;
  validateRefundPayload(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 422);
});
