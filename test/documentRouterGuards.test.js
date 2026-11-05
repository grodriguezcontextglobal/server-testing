'use strict';

/**
 * /api/document (FedRAMP P1.1, 2026-10-21). Este router no puede denegar por
 * defecto con router.use (GET /:id es pública y capturaría /types y /triggers),
 * así que la invariante se comprueba ruta a ruta: toda ruta lleva validateJWT
 * salvo las de PUBLIC_ROUTES, y la lista no tiene entradas que no existan.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveChain } = require('./helpers/effectiveChain');

const router = require('../routes/document');
const routes = router.stack
  .filter((l) => l.route)
  .flatMap((l) => Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route.path })));
const key = (r) => `${r.method} ${r.path}`;

test('toda ruta de /api/document exige sesión salvo PUBLIC_ROUTES', () => {
  const open = routes
    .filter((r) => !router.PUBLIC_ROUTES.includes(key(r)))
    .filter((r) => !effectiveChain(router, r.method, r.path).some((h) => h.name === 'validateJWT'))
    .map(key);
  assert.deepEqual(open, []);
});

test('PUBLIC_ROUTES solo nombra rutas que existen', () => {
  const keys = routes.map(key);
  assert.deepEqual(router.PUBLIC_ROUTES.filter((k) => !keys.includes(k)), []);
});

test('crear una verificación exige sesión', () => {
  for (const who of ['staff_member', 'consumer_member', 'member']) {
    const chain = effectiveChain(router, 'POST', `/verification/${who}/signed_document`);
    assert.ok(chain.some((h) => h.name === 'validateJWT'), who);
  }
});
