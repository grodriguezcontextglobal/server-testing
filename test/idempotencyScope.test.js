'use strict';

// Stripe Fase 1.2 (2026-10-19): la Idempotency-Key del cliente, acotada a
// compañía, usuario y ruta, en la caché de respuestas y en la clave de Stripe.

const test = require('node:test');
const assert = require('node:assert/strict');
const { scopeIdempotencyKey } = require('../helpers/idempotencyScope');

process.env.PAYMENTS_MUTATION_IDEMPOTENCY_STORE = 'memory';
const { idempotencyMutationCache, __idempotencyStore, __idempotencyFlush } = require('../middlewares/idempotencyMutationCache');

const req = ({ company = 'A', uid = 'u1', path = '/refund', key = 'K', body = { paymentIntent: 'pi_1' } } = {}) => {
  const headers = { 'x-company-id': company, 'idempotency-key': key };
  return {
    method: 'POST', baseUrl: '/api/stripe', path, uid, body, params: {}, originalUrl: `/api/stripe${path}`,
    headers, header: (n) => headers[n.toLowerCase()], get: (n) => headers[n.toLowerCase()],
  };
};

test('scopeIdempotencyKey: mismo contexto → misma clave; cualquier cambio de contexto → otra', () => {
  const base = scopeIdempotencyKey(req(), 'K');
  assert.equal(base, scopeIdempotencyKey(req(), ' K '), 'reintento');
  assert.notEqual(base, scopeIdempotencyKey(req({ company: 'B' }), 'K'), 'otra compañía');
  assert.notEqual(base, scopeIdempotencyKey(req({ uid: 'u2' }), 'K'), 'otro usuario');
  assert.notEqual(base, scopeIdempotencyKey(req({ path: '/partial-refund' }), 'K'), 'otra ruta');
  assert.notEqual(base, 'K');
  assert.match(base, /^[a-f0-9]{64}$/);
});

const run = async (r) => {
  const res = { statusCode: 200, headersSent: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.on = () => {};
  res.setHeader = () => {};
  let ranHandler = false;
  await new Promise((resolve) => {
    const out = idempotencyMutationCache(r, res, () => {
      ranHandler = true;
      res.status(201).json({ ok: true, by: r.headers['x-company-id'] });
      resolve();
    });
    Promise.resolve(out).then(() => setImmediate(resolve));
  });
  await __idempotencyFlush();
  return { ranHandler, res };
};

test('caché: la misma clave en OTRA compañía ya no devuelve la respuesta guardada de la primera', async () => {
  __idempotencyStore.clear();
  const a = await run(req({ company: 'A' }));
  assert.equal(a.ranHandler, true);
  const b = await run(req({ company: 'B', uid: 'u2' }));
  assert.equal(b.ranHandler, true, 'B ejecuta su propia petición');
  assert.equal(b.res.body.by, 'B');
});

test('caché: un reintento en el mismo contexto sí recibe la respuesta guardada', async () => {
  __idempotencyStore.clear();
  await run(req());
  const again = await run(req());
  assert.equal(again.ranHandler, false);
  assert.equal(again.res.body.by, 'A');
});
