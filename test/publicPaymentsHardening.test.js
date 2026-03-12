const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePublicPaymentPayload } = require('../middlewares/validatePublicPaymentPayload');
const { attachServerIdempotencyKey } = require('../middlewares/attachServerIdempotencyKey');
const { publicPaymentRateLimit } = require('../middlewares/publicPaymentRateLimit');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('validatePublicPaymentPayload allows positive numeric device', () => {
  const req = { body: { device: 10 } };
  const res = mockRes();
  let nextCalled = false;
  validatePublicPaymentPayload(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('validatePublicPaymentPayload rejects invalid device', () => {
  const req = { body: { device: 'abc' } };
  const res = mockRes();
  let nextCalled = false;
  validatePublicPaymentPayload(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.ok, false);
});

test('attachServerIdempotencyKey respects provided key', () => {
  const req = {
    body: { customerEmail: 'a@b.com', customerId: 'c1', device: 10 },
    get: (header) => (header.toLowerCase() === 'idempotency-key' ? 'provided-key' : undefined),
    ip: '1.2.3.4',
  };
  attachServerIdempotencyKey(req, {}, () => {});
  assert.equal(req.idempotencyKey, 'provided-key');
});

test('attachServerIdempotencyKey generates deterministic key in same bucket', () => {
  const req1 = {
    body: { customerEmail: 'a@b.com', customerId: 'c1', device: 10 },
    get: () => undefined,
    ip: '1.2.3.4',
  };
  const req2 = {
    body: { customerEmail: 'a@b.com', customerId: 'c1', device: 10 },
    get: () => undefined,
    ip: '1.2.3.4',
  };
  attachServerIdempotencyKey(req1, {}, () => {});
  attachServerIdempotencyKey(req2, {}, () => {});
  assert.equal(req1.idempotencyKey, req2.idempotencyKey);
});

test('publicPaymentRateLimit allows initial requests then blocks burst', () => {
  const req = {
    headers: {},
    originalUrl: '/api/stripe/create-payment-intent',
    path: '/api/stripe/create-payment-intent',
    ip: '5.6.7.8',
    socket: { remoteAddress: '5.6.7.8' },
  };

  let blocked = false;
  for (let i = 0; i < 31; i++) {
    const res = mockRes();
    let nextCalled = false;
    publicPaymentRateLimit(req, res, () => { nextCalled = true; });
    if (!nextCalled) {
      blocked = true;
      assert.equal(res.statusCode, 429);
      assert.equal(res.body.ok, false);
      break;
    }
  }
  assert.equal(blocked, true);
});
