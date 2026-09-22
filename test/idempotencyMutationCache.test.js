const test = require('node:test');
const assert = require('node:assert/strict');

// Este middleware usa Redis cuando está configurado. Aquí se fija el almacén en
// memoria para que la prueba no dependa del .env de la máquina que la corre.
process.env.PAYMENTS_MUTATION_IDEMPOTENCY_STORE = 'memory';

const {
  idempotencyMutationCache,
  __idempotencyStore,
  __idempotencyFlush,
} = require('../middlewares/idempotencyMutationCache');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    listeners: {},
    on(event, fn) { this.listeners[event] = fn; return this; },
    finish() { if (this.listeners.finish) this.listeners.finish(); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

const refundReq = (overrides = {}) => ({
  method: 'POST',
  path: '/refund',
  originalUrl: '/api/stripe/refund',
  route: { path: '/refund' },
  params: {},
  body: { payment_intent: 'pi_123' },
  get: () => undefined,
  ...overrides,
});

test('idempotencyMutationCache stores first successful response and replays duplicate', async () => {
  __idempotencyStore.clear();
  const req = refundReq();

  const res1 = mockRes();
  let nextCalled1 = false;
  await idempotencyMutationCache(req, res1, () => { nextCalled1 = true; });
  assert.equal(nextCalled1, true);
  res1.status(201).json({ ok: true, msg: 'created' });
  await __idempotencyFlush();

  const res2 = mockRes();
  let nextCalled2 = false;
  await idempotencyMutationCache(req, res2, () => { nextCalled2 = true; });
  assert.equal(nextCalled2, false);
  assert.equal(res2.statusCode, 201);
  assert.deepEqual(res2.payload, { ok: true, msg: 'created' });
});

test('idempotencyMutationCache uses explicit Idempotency-Key header when present', async () => {
  __idempotencyStore.clear();

  const baseReq = refundReq({
    body: { payment_intent: 'pi_abc' },
    get: (k) => (k.toLowerCase() === 'idempotency-key' ? 'custom-k' : undefined),
  });

  const res1 = mockRes();
  await idempotencyMutationCache(baseReq, res1, () => {});
  res1.status(200).json({ ok: true, msg: 'same' });
  await __idempotencyFlush();

  const req2 = { ...baseReq, body: { payment_intent: 'pi_different' } };
  const res2 = mockRes();
  let nextCalled = false;
  await idempotencyMutationCache(req2, res2, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.deepEqual(res2.payload, { ok: true, msg: 'same' });
});

// El caso que el Map en memoria no cubría: dos peticiones simultáneas. Antes las
// dos llegaban al handler porque la respuesta solo se guardaba AL TERMINAR.
test('idempotencyMutationCache rejects a duplicate that arrives while the first is still running', async () => {
  __idempotencyStore.clear();
  const req = refundReq({ body: { payment_intent: 'pi_concurrent' } });

  const res1 = mockRes();
  let handlerRuns = 0;
  await idempotencyMutationCache(req, res1, () => { handlerRuns += 1; });

  // La primera todavía no ha respondido. Llega la segunda.
  const res2 = mockRes();
  await idempotencyMutationCache(req, res2, () => { handlerRuns += 1; });

  assert.equal(handlerRuns, 1, 'el handler solo puede ejecutarse una vez');
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.payload.ok, false);
});

// Una reserva que no produce respuesta no puede bloquear el reintento.
test('idempotencyMutationCache releases the reservation when the request fails with 5xx', async () => {
  __idempotencyStore.clear();
  const req = refundReq({ body: { payment_intent: 'pi_boom' } });

  const res1 = mockRes();
  await idempotencyMutationCache(req, res1, () => {});
  res1.status(500).json({ ok: false, msg: 'stripe down' });
  res1.finish();
  await __idempotencyFlush();

  const res2 = mockRes();
  let retried = false;
  await idempotencyMutationCache(req, res2, () => { retried = true; });

  assert.equal(retried, true, 'tras un 5xx el reintento tiene que poder ejecutarse');
});
