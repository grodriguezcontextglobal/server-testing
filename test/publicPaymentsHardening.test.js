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

// Stripe Fase 1.2 (2026-10-19): la clave del cliente se respeta (misma clave →
// misma clave para Stripe, así un reintento no cobra dos veces), pero ya no se
// pasa CRUDA: va acotada a compañía, usuario y ruta. Una sola cuenta de Stripe
// para todas las compañías hacía que la misma clave devolviera el PaymentIntent
// de otra.
test('attachServerIdempotencyKey respects provided key, scoped (never raw)', () => {
  const mk = (company, uid) => ({
    method: 'POST', baseUrl: '/api/stripe', path: '/create-payment-intent', uid,
    headers: company ? { 'x-company-id': company } : {},
    body: { customerEmail: 'a@b.com', customerId: 'c1', device: 10 },
    get: (header) => (header.toLowerCase() === 'idempotency-key' ? 'provided-key' : undefined),
    ip: '1.2.3.4',
  });
  const a1 = mk('companyA', 'u1');
  const a2 = mk('companyA', 'u1');
  const b = mk('companyB', 'u2');
  for (const r of [a1, a2, b]) attachServerIdempotencyKey(r, {}, () => {});
  assert.notEqual(a1.idempotencyKey, 'provided-key');
  assert.equal(a1.idempotencyKey, a2.idempotencyKey, 'mismo contexto y clave → misma clave (reintento)');
  assert.notEqual(a1.idempotencyKey, b.idempotencyKey, 'otra compañía con la misma clave → otra clave');
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
