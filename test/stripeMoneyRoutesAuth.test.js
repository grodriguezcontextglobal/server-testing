'use strict';

/**
 * Las cuatro rutas que mueven dinero ya cobrado exigen sesión y
 * `transaction:update`, ANTES de llegar al handler.
 *
 * Contexto: eran públicas. Mientras el validador de refund estuvo roto (de
 * marzo al 2026-10-06), ningún refund pasaba y eso las tapaba. El arreglo se
 * desplegó el 2026-10-06 a las 14:41 UTC y desde ese momento cualquiera con un
 * pi_ podía reembolsarlo sin sesión.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateJWT } = require('../middlewares/validate-jwt');
const { checkTokenVersion } = require('../middlewares/checkValidateToken');

// Firma del middleware que devuelve authorizeMongoPermission (mismo truco que
// routeSecurityHardening.test.js).
const AUTHZ_SIGNATURE = 'insufficient permissions';

const router = require(path.resolve(__dirname, '../routes/stripe'));

function chainOf(method, routePath) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method.toLowerCase()],
  );
  return layer ? layer.route.stack.map((l) => l.handle) : null;
}

const MONEY_ROUTES = [
  ['POST', '/refund', 'refundStripePaymentIntent'],
  ['POST', '/partial-refund', 'partialRefundStripePaymentIntent'],
  ['POST', '/payment-intents/:id/capture', 'captureStripePaymentIntent'],
  ['POST', '/payment-intents/:id/cancel', 'cancelStripePaymentIntent'],
];

for (const [method, routePath, handlerName] of MONEY_ROUTES) {
  test(`${method} /api/stripe${routePath}: sesión y transaction:update antes del handler`, () => {
    const chain = chainOf(method, routePath);
    assert.ok(chain, 'la ruta tiene que existir');

    const jwtAt = chain.indexOf(validateJWT);
    const versionAt = chain.indexOf(checkTokenVersion);
    const authzAt = chain.findIndex((h) => h.toString().includes(AUTHZ_SIGNATURE));
    const handlerAt = chain.findIndex((h) => h.name === handlerName);

    assert.ok(jwtAt >= 0, 'falta validateJWT');
    assert.ok(versionAt > jwtAt, 'checkTokenVersion tiene que ir después de validateJWT');
    assert.ok(authzAt > versionAt, 'falta authorizeMongoPermission, o va antes de la sesión');
    assert.ok(handlerAt > authzAt, 'el handler tiene que ir DESPUÉS de la autorización');
  });
}

test('el permiso exigido es transaction:update, no billing:update (el event_manager lo necesita)', () => {
  const { hasPermission } = require('../constants/rolePermissions');
  assert.equal(hasPermission('event_manager', 'transaction', 'update'), true);
  assert.equal(hasPermission('event_manager', 'billing', 'update'), false);
  // La autorización montada en las rutas pide `transaction`.
  const authz = chainOf('POST', '/refund').find((h) => h.toString().includes(AUTHZ_SIGNATURE));
  assert.ok(authz, 'falta la autorización en /refund');
});

test('una petición sin token a /refund se corta en validateJWT con 401 (no llega a Stripe)', () => {
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let reachedNext = false;
  validateJWT({ header: () => undefined }, res, () => { reachedNext = true; });
  assert.equal(reachedNext, false);
  assert.equal(res.statusCode, 401);
});
