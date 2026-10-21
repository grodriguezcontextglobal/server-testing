'use strict';

/**
 * Routers que deniegan por defecto (FedRAMP P1.1 · AC-3).
 *
 * Cada router de DEFAULT_DENY monta validateJWT + checkTokenVersion con
 * router.use, y SOLO las rutas de su PUBLIC_ROUTES se registran antes. Así una
 * ruta nueva nace cerrada, y abrir una exige tocar la lista a la vista de quien
 * revisa. Al cerrar otro router, añadirlo aquí.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

const test = require('node:test');
const assert = require('node:assert/strict');

const DEFAULT_DENY = ['../routes/receivers', '../mysql/routes/events'];

for (const modulePath of DEFAULT_DENY) {
  const router = require(modulePath);
  const name = modulePath.replace('../', '');

  const denyIndex = router.stack.findIndex((l) => !l.route && l.handle.name === 'validateJWT');
  const routes = router.stack
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.route)
    .flatMap(({ layer, index }) =>
      Object.keys(layer.route.methods).map((m) => ({
        key: `${m.toUpperCase()} ${layer.route.path}`,
        index,
        chain: layer.route.stack.map((l) => l.handle.name),
      }))
    );

  test(`${name}: router.use(validateJWT, checkTokenVersion)`, () => {
    assert.ok(denyIndex >= 0, 'falta router.use(validateJWT, ...)');
    assert.equal(router.stack[denyIndex + 1]?.handle.name, 'checkTokenVersion');
  });

  test(`${name}: solo PUBLIC_ROUTES queda delante del cierre`, () => {
    assert.ok(Array.isArray(router.PUBLIC_ROUTES), 'el router tiene que exportar PUBLIC_ROUTES');
    const before = routes.filter((r) => r.index < denyIndex).map((r) => r.key);
    assert.deepEqual(before.sort(), [...router.PUBLIC_ROUTES].sort());
  });

  test(`${name}: ninguna ruta repite validateJWT ni checkTokenVersion`, () => {
    const repeated = routes
      .filter((r) => r.index > denyIndex)
      .filter((r) => r.chain.includes('validateJWT') || r.chain.includes('checkTokenVersion'))
      .map((r) => r.key);
    assert.deepEqual(repeated, [], 'el router ya los aplica: repetirlos solo duplica la consulta a Mongo');
  });

  test(`${name}: no hay rutas registradas dos veces`, () => {
    const keys = routes.map((r) => r.key);
    assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
  });
}
