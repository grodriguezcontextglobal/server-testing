const test = require('node:test');
const assert = require('node:assert/strict');
const { idempotencyMutationCache, __idempotencyStore } = require('../middlewares/idempotencyMutationCache');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

test('idempotencyMutationCache stores first successful response and replays duplicate', () => {
  __idempotencyStore.clear();

  const req = {
    method: 'POST',
    path: '/refund',
    originalUrl: '/api/stripe/refund',
    route: { path: '/refund' },
    params: {},
    body: { payment_intent: 'pi_123' },
    get: () => undefined,
  };

  const res1 = mockRes();
  let nextCalled1 = false;
  idempotencyMutationCache(req, res1, () => { nextCalled1 = true; });
  assert.equal(nextCalled1, true);
  res1.status(201).json({ ok: true, msg: 'created' });

  const res2 = mockRes();
  let nextCalled2 = false;
  idempotencyMutationCache(req, res2, () => { nextCalled2 = true; });
  assert.equal(nextCalled2, false);
  assert.equal(res2.statusCode, 201);
  assert.deepEqual(res2.payload, { ok: true, msg: 'created' });
});

test('idempotencyMutationCache uses explicit Idempotency-Key header when present', () => {
  __idempotencyStore.clear();

  const baseReq = {
    method: 'POST',
    path: '/refund',
    originalUrl: '/api/stripe/refund',
    route: { path: '/refund' },
    params: {},
    body: { payment_intent: 'pi_abc' },
    get: (k) => (k.toLowerCase() === 'idempotency-key' ? 'custom-k' : undefined),
  };

  const res1 = mockRes();
  idempotencyMutationCache(baseReq, res1, () => {});
  res1.status(200).json({ ok: true, msg: 'same' });

  const req2 = { ...baseReq, body: { payment_intent: 'pi_different' } };
  const res2 = mockRes();
  let nextCalled = false;
  idempotencyMutationCache(req2, res2, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.deepEqual(res2.payload, { ok: true, msg: 'same' });
});
