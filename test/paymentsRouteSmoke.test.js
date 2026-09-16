const test = require('node:test');
const assert = require('node:assert/strict');

const { optionalJWT } = require('../middlewares/optionalJWT');
const { publicPaymentRateLimit } = require('../middlewares/publicPaymentRateLimit');
const { validatePublicPaymentPayload } = require('../middlewares/validatePublicPaymentPayload');
const { attachServerIdempotencyKey } = require('../middlewares/attachServerIdempotencyKey');
const { validatePaymentIntentIdParam, validateRefundPayload } = require('../middlewares/validateStripeRoutePayload');
// El middleware de idempotencia usa Redis cuando esta configurado; aqui se fija
// en memoria para que el smoke no dependa del .env de la maquina.
process.env.PAYMENTS_MUTATION_IDEMPOTENCY_STORE = 'memory';
const {
  idempotencyMutationCache,
  __idempotencyStore,
  __idempotencyFlush,
} = require('../middlewares/idempotencyMutationCache');

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

function baseReq(overrides = {}) {
  return {
    method: 'POST',
    headers: {},
    originalUrl: '/api/stripe/create-payment-intent',
    path: '/api/stripe/create-payment-intent',
    route: { path: '/create-payment-intent' },
    params: {},
    body: {},
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    header(name) { return this.headers[name.toLowerCase()] || this.headers[name] || undefined; },
    get(name) { return this.headers[name.toLowerCase()] || this.headers[name] || undefined; },
    ...overrides,
  };
}

function runChain(req, res, middlewares) {
  let idx = 0;
  const next = () => {
    if (res.body) return;
    const mw = middlewares[idx++];
    if (!mw) return;
    mw(req, res, next);
  };
  next();
}

// Version await-able, para las cadenas que incluyen middleware asincrono.
async function runChainAsync(req, res, middlewares) {
  let idx = 0;
  const next = async () => {
    if (res.body) return;
    const mw = middlewares[idx++];
    if (!mw) return;
    await mw(req, res, next);
  };
  await next();
}

test('smoke: create-payment-intent middleware chain allows valid public request', () => {
  const req = baseReq({ body: { device: 25, customerEmail: 'user@test.com' } });
  const res = mockRes();

  runChain(req, res, [
    optionalJWT,
    publicPaymentRateLimit,
    validatePublicPaymentPayload,
    attachServerIdempotencyKey,
  ]);

  assert.equal(res.body, null);
  assert.equal(req.authContext.lane, 'public');
  assert.ok(req.idempotencyKey);
});

test('smoke: create-payment-intent middleware chain blocks invalid payload', () => {
  const req = baseReq({ body: { device: 0 } });
  const res = mockRes();

  runChain(req, res, [
    optionalJWT,
    publicPaymentRateLimit,
    validatePublicPaymentPayload,
    attachServerIdempotencyKey,
  ]);

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.ok, false);
});

test('smoke: capture path rejects invalid payment intent id', () => {
  const req = baseReq({
    originalUrl: '/api/stripe/payment-intents/bad/capture',
    path: '/api/stripe/payment-intents/bad/capture',
    route: { path: '/payment-intents/:id/capture' },
    params: { id: 'bad' },
  });
  const res = mockRes();

  runChain(req, res, [publicPaymentRateLimit, validatePaymentIntentIdParam]);

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.ok, false);
});

test('smoke: refund path rejects invalid payload', () => {
  const req = baseReq({
    originalUrl: '/api/stripe/refund',
    path: '/api/stripe/refund',
    route: { path: '/refund' },
    body: { payment_intent: 'invalid' },
  });
  const res = mockRes();

  runChain(req, res, [publicPaymentRateLimit, validateRefundPayload]);

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.ok, false);
});

test('smoke: mutation idempotency cache replays duplicate mutation response', async () => {
  __idempotencyStore.clear();

  const req = baseReq({
    originalUrl: '/api/stripe/refund',
    path: '/api/stripe/refund',
    route: { path: '/refund' },
    body: { payment_intent: 'pi_123456' },
  });

  const res1 = mockRes();
  await runChainAsync(req, res1, [idempotencyMutationCache]);
  res1.status(201).json({ ok: true, msg: 'refunded' });
  await __idempotencyFlush();

  const res2 = mockRes();
  await runChainAsync(req, res2, [idempotencyMutationCache]);

  assert.equal(res2.statusCode, 201);
  assert.deepEqual(res2.body, { ok: true, msg: 'refunded' });
});
