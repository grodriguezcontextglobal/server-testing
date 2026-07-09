'use strict';

/**
 * routes/consumer.js — namespace público para la app de consumer (attendees).
 *
 * Contrato: estas rutas NO deben exigir token. Reutilizan controllers ya
 * existentes y aplican `optionalJWT` (no bloquea; solo detecta token si viene).
 *
 * Estos tests inspeccionan estáticamente el stack del Router — no levantan un
 * servidor HTTP — siguiendo el mismo patrón que routeSecurityHardening.test.js.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const { optionalJWT } = require('../middlewares/optionalJWT');
const { validateJWT } = require('../middlewares/validate-jwt');

// Recarga un módulo de ruta limpiando su entrada en require.cache.
function loadRouter(relativePath) {
  const fullPath = path.resolve(__dirname, relativePath);
  delete require.cache[fullPath];
  return require(fullPath);
}

// Devuelve los handles de una ruta concreta del stack, o null si no existe.
function getRouteHandlers(router, method, routePath) {
  const layer = router.stack.find(
    l => l.route &&
         l.route.path === routePath &&
         l.route.methods[method.toLowerCase()],
  );
  if (!layer) return null;
  return layer.route.stack.map(l => l.handle);
}

// Las 3 rutas públicas que desbloquean el flujo del consumer.
const PUBLIC_ROUTES = [
  ['POST', '/stripe/find-customer'],
  ['POST', '/stripe/create-customer'],
  ['GET',  '/users'],
];

for (const [method, routePath] of PUBLIC_ROUTES) {
  test(`routes/consumer.js: ${method} ${routePath} existe`, () => {
    const router = loadRouter('../routes/consumer');
    const handlers = getRouteHandlers(router, method, routePath);
    assert.ok(handlers !== null, `La ruta ${method} ${routePath} debe existir`);
  });

  test(`routes/consumer.js: ${method} ${routePath} usa optionalJWT (no bloquea)`, () => {
    const router = loadRouter('../routes/consumer');
    const handlers = getRouteHandlers(router, method, routePath);
    assert.ok(handlers !== null, `La ruta ${method} ${routePath} debe existir`);
    assert.ok(
      handlers.includes(optionalJWT),
      `optionalJWT debe estar en la cadena de ${method} ${routePath}`,
    );
  });

  test(`routes/consumer.js: ${method} ${routePath} NO exige validateJWT`, () => {
    const router = loadRouter('../routes/consumer');
    const handlers = getRouteHandlers(router, method, routePath);
    assert.ok(handlers !== null, `La ruta ${method} ${routePath} debe existir`);
    assert.ok(
      !handlers.includes(validateJWT),
      `validateJWT NO debe estar en ${method} ${routePath} (ruta pública)`,
    );
  });
}
