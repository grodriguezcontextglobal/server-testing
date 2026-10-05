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

test('validateRefundPayload accepts paymentIntent (lo que manda el dashboard)', () => {
  const req = { body: { paymentIntent: 'pi_3UMEiCJAluu3aB960UpiiYL6' } };
  const res = mockRes();
  let nextCalled = false;
  validateRefundPayload(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.body.paymentIntent, 'pi_3UMEiCJAluu3aB960UpiiYL6');
});

test('validateRefundPayload normaliza payment_intent y paymentIntentId a paymentIntent', () => {
  for (const key of ['payment_intent', 'paymentIntentId']) {
    const req = { body: { [key]: 'pi_abc12345' } };
    validateRefundPayload(req, mockRes(), () => {});
    assert.equal(req.body.paymentIntent, 'pi_abc12345', key);
  }
});

test('validateRefundPayload rejects missing/invalid payload', () => {
  const req = { body: { payment_intent: '123' } };
  const res = mockRes();
  let nextCalled = false;
  validateRefundPayload(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 422);
});
