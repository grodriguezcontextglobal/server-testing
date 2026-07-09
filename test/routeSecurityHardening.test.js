'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// ─── helpers ─────────────────────────────────────────────────────────────────

const { validateJWT } = require('../middlewares/validate-jwt');

// Firma textual única de authorizePermission — presente en el cuerpo de cada
// función retornada por la factory. Usada para inspección del stack de rutas.
const AUTHZ_SIGNATURE = 'insufficient permissions';

// Inspecciona el stack de un Express Router y devuelve los handles de una
// ruta concreta. Retorna null si la ruta no existe.
function getRouteHandlers(router, method, routePath) {
  const layer = router.stack.find(
    l => l.route &&
         l.route.path === routePath &&
         l.route.methods[method.toLowerCase()],
  );
  if (!layer) return null;
  return layer.route.stack.map(l => l.handle);
}

// Recarga un módulo de ruta limpiando su entrada en require.cache.
function loadRouter(relativePath) {
  const fullPath = path.resolve(__dirname, relativePath);
  delete require.cache[fullPath];
  return require(fullPath);
}

// Retorna true si alguno de los handlers contiene la firma de authorizePermission.
function hasAuthzPermission(handlers) {
  return handlers.some(h => h.toString().includes(AUTHZ_SIGNATURE));
}

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE A — routes/auth.js
// RED: las rutas GET /:id y GET /all-consumers-… no tienen validateJWT todavía.
// ════════════════════════════════════════════════════════════════════════════

test('routes/auth.js: GET /:id tiene validateJWT en su cadena', () => {
  const router = loadRouter('../routes/auth');
  const handlers = getRouteHandlers(router, 'GET', '/:id');
  assert.ok(handlers !== null, 'La ruta GET /:id debe existir');
  assert.ok(
    handlers.includes(validateJWT),
    'validateJWT debe estar en la cadena de GET /:id',
  );
});

test('routes/auth.js: GET /all-consumers-based-on-all-events-per-company/:companyID tiene validateJWT', () => {
  const router = loadRouter('../routes/auth');
  const handlers = getRouteHandlers(
    router, 'GET',
    '/all-consumers-based-on-all-events-per-company/:companyID',
  );
  assert.ok(handlers !== null, 'La ruta GET /all-consumers-… debe existir');
  assert.ok(
    handlers.includes(validateJWT),
    'validateJWT debe estar en GET /all-consumers-…',
  );
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE B — mysql/routes/company.js: authorizePermission en rutas críticas
// RED: las rutas no tienen authorizePermission todavía.
// ════════════════════════════════════════════════════════════════════════════

test('mysql/routes/company.js: POST /update_company tiene authorizePermission', () => {
  const router = loadRouter('../mysql/routes/company');
  const handlers = getRouteHandlers(router, 'POST', '/update_company');
  assert.ok(handlers !== null, 'La ruta POST /update_company debe existir');
  assert.ok(
    hasAuthzPermission(handlers),
    'authorizePermission debe estar en POST /update_company',
  );
});

test('mysql/routes/company.js: DELETE /:id tiene authorizePermission o mapeo de company_id', () => {
  const router = loadRouter('../mysql/routes/company');
  const handlers = getRouteHandlers(router, 'DELETE', '/:id');
  assert.ok(handlers !== null, 'La ruta DELETE /:id debe existir');
  // Acepta: authorizePermission directo O un middleware que mapee params.id → params.company_id
  const chainCode = handlers.map(h => h.toString()).join('\n');
  assert.ok(
    hasAuthzPermission(handlers) || chainCode.includes('company_id'),
    'DELETE /:id debe tener authorizePermission o mapeo de company_id',
  );
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE C — mysql/routes/consumers.js
// RED: DELETE /:id no tiene authorizePermission todavía.
// ════════════════════════════════════════════════════════════════════════════

test('mysql/routes/consumers.js: DELETE /:id tiene authorizePermission', () => {
  const router = loadRouter('../mysql/routes/consumers');
  const handlers = getRouteHandlers(router, 'DELETE', '/:id');
  assert.ok(handlers !== null, 'La ruta DELETE /:id debe existir en consumers');
  assert.ok(
    hasAuthzPermission(handlers),
    'authorizePermission debe estar en DELETE /api/db_consumer/:id',
  );
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE D — mysql/routes/events.js
// RED: DELETE /:id no tiene authorizePermission todavía.
// ════════════════════════════════════════════════════════════════════════════

test('mysql/routes/events.js: DELETE /:id tiene authorizePermission', () => {
  const router = loadRouter('../mysql/routes/events');
  const handlers = getRouteHandlers(router, 'DELETE', '/:id');
  assert.ok(handlers !== null, 'La ruta DELETE /:id debe existir en events');
  assert.ok(
    hasAuthzPermission(handlers),
    'authorizePermission debe estar en DELETE /api/db_event/:id',
  );
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE E — mysql/routes/item.js: tres rutas de eliminación
// RED: ninguna tiene authorizePermission todavía.
// ════════════════════════════════════════════════════════════════════════════

test('mysql/routes/item.js: POST /delete-item tiene authorizePermission', () => {
  const router = loadRouter('../mysql/routes/item');
  const handlers = getRouteHandlers(router, 'POST', '/delete-item');
  assert.ok(handlers !== null, 'La ruta POST /delete-item debe existir');
  assert.ok(hasAuthzPermission(handlers), 'authorizePermission debe estar en POST /delete-item');
});

test('mysql/routes/item.js: POST /delete-bulk-items tiene authorizePermission', () => {
  const router = loadRouter('../mysql/routes/item');
  const handlers = getRouteHandlers(router, 'POST', '/delete-bulk-items');
  assert.ok(handlers !== null, 'La ruta POST /delete-bulk-items debe existir');
  assert.ok(hasAuthzPermission(handlers), 'authorizePermission debe estar en POST /delete-bulk-items');
});

test('mysql/routes/item.js: POST /delete-bulk-items-criteria tiene authorizePermission', () => {
  const router = loadRouter('../mysql/routes/item');
  const handlers = getRouteHandlers(router, 'POST', '/delete-bulk-items-criteria');
  assert.ok(handlers !== null, 'La ruta POST /delete-bulk-items-criteria debe existir');
  assert.ok(hasAuthzPermission(handlers), 'authorizePermission debe estar en POST /delete-bulk-items-criteria');
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE F — rutas MongoDB: authorizeMongoPermission en rutas críticas
// La firma textual de authorizeMongoPermission usada para inspección del stack.
// RED: ninguna de estas rutas tiene authorizeMongoPermission todavía.
// ════════════════════════════════════════════════════════════════════════════

const AUTHZ_MONGO_SIGNATURE = 'Forbidden: insufficient permissions';

function hasAuthzMongoPermission(handlers) {
  return handlers.some(h => h.toString().includes(AUTHZ_MONGO_SIGNATURE));
}

test('routes/company.js: PATCH /update-company/:id tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/company');
  const handlers = getRouteHandlers(router, 'PATCH', '/update-company/:id');
  assert.ok(handlers !== null, 'La ruta PATCH /update-company/:id debe existir');
  assert.ok(
    hasAuthzMongoPermission(handlers),
    'authorizeMongoPermission debe estar en PATCH /update-company/:id',
  );
});

test('routes/staff.js: PATCH /edit-admin/:id tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/staff');
  const handlers = getRouteHandlers(router, 'PATCH', '/edit-admin/:id');
  assert.ok(handlers !== null, 'La ruta PATCH /edit-admin/:id debe existir');
  assert.ok(
    hasAuthzMongoPermission(handlers),
    'authorizeMongoPermission debe estar en PATCH /edit-admin/:id',
  );
});

test('routes/admin.js: GET /:id tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/admin');
  const handlers = getRouteHandlers(router, 'GET', '/:id');
  assert.ok(handlers !== null, 'La ruta GET /:id debe existir en admin');
  assert.ok(
    hasAuthzMongoPermission(handlers),
    'authorizeMongoPermission debe estar en GET /:id',
  );
});

test('routes/admin.js: PATCH /admin-user/:id tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/admin');
  const handlers = getRouteHandlers(router, 'PATCH', '/admin-user/:id');
  assert.ok(handlers !== null, 'La ruta PATCH /admin-user/:id debe existir');
  assert.ok(
    hasAuthzMongoPermission(handlers),
    'authorizeMongoPermission debe estar en PATCH /admin-user/:id',
  );
});

test('routes/admin.js: DELETE /:id tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/admin');
  const handlers = getRouteHandlers(router, 'DELETE', '/:id');
  assert.ok(handlers !== null, 'La ruta DELETE /:id debe existir en admin');
  assert.ok(
    hasAuthzMongoPermission(handlers),
    'authorizeMongoPermission debe estar en DELETE /:id',
  );
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE G — routes/stripe.js: rutas internas y admin requieren auth
// Estas rutas usaban optionalJWT tras relajación temporal para desarrollo.
// RED: ninguna tiene authorizeMongoPermission todavía.
// ════════════════════════════════════════════════════════════════════════════

test('routes/stripe.js: POST /internal/payment-intents/:id/capture tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/stripe');
  const handlers = getRouteHandlers(router, 'POST', '/internal/payment-intents/:id/capture');
  assert.ok(handlers !== null, 'La ruta POST /internal/payment-intents/:id/capture debe existir');
  assert.ok(hasAuthzMongoPermission(handlers), 'authorizeMongoPermission debe estar en capture');
});

test('routes/stripe.js: POST /internal/payment-intents/:id/cancel tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/stripe');
  const handlers = getRouteHandlers(router, 'POST', '/internal/payment-intents/:id/cancel');
  assert.ok(handlers !== null, 'La ruta POST /internal/payment-intents/:id/cancel debe existir');
  assert.ok(hasAuthzMongoPermission(handlers), 'authorizeMongoPermission debe estar en cancel');
});

test('routes/stripe.js: POST /internal/refund tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/stripe');
  const handlers = getRouteHandlers(router, 'POST', '/internal/refund');
  assert.ok(handlers !== null, 'La ruta POST /internal/refund debe existir');
  assert.ok(hasAuthzMongoPermission(handlers), 'authorizeMongoPermission debe estar en /internal/refund');
});

test('routes/stripe.js: POST /internal/partial-refund tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/stripe');
  const handlers = getRouteHandlers(router, 'POST', '/internal/partial-refund');
  assert.ok(handlers !== null, 'La ruta POST /internal/partial-refund debe existir');
  assert.ok(hasAuthzMongoPermission(handlers), 'authorizeMongoPermission debe estar en /internal/partial-refund');
});

test('routes/stripe.js: GET /customers tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/stripe');
  const handlers = getRouteHandlers(router, 'GET', '/customers');
  assert.ok(handlers !== null, 'La ruta GET /customers debe existir');
  assert.ok(hasAuthzMongoPermission(handlers), 'authorizeMongoPermission debe estar en GET /customers');
});

test('routes/stripe.js: POST /customers tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/stripe');
  const handlers = getRouteHandlers(router, 'POST', '/customers');
  assert.ok(handlers !== null, 'La ruta POST /customers debe existir');
  assert.ok(hasAuthzMongoPermission(handlers), 'authorizeMongoPermission debe estar en POST /customers');
});

test('routes/stripe.js: GET /customers/search tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/stripe');
  const handlers = getRouteHandlers(router, 'GET', '/customers/search');
  assert.ok(handlers !== null, 'La ruta GET /customers/search debe existir');
  assert.ok(hasAuthzMongoPermission(handlers), 'authorizeMongoPermission debe estar en /customers/search');
});

test('routes/stripe.js: POST /stripe-transaction-admin tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/stripe');
  const handlers = getRouteHandlers(router, 'POST', '/stripe-transaction-admin');
  assert.ok(handlers !== null, 'La ruta POST /stripe-transaction-admin debe existir');
  assert.ok(hasAuthzMongoPermission(handlers), 'authorizeMongoPermission debe estar en /stripe-transaction-admin');
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE H — routes/staff.js: /admin-users expone lista de staff sin auth
// RED: ambas rutas usan optionalJWT, no tienen authorizeMongoPermission.
// ════════════════════════════════════════════════════════════════════════════

test('routes/staff.js: GET /admin-users tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/staff');
  const handlers = getRouteHandlers(router, 'GET', '/admin-users');
  assert.ok(handlers !== null, 'La ruta GET /admin-users debe existir');
  assert.ok(
    hasAuthzMongoPermission(handlers),
    'authorizeMongoPermission debe estar en GET /admin-users',
  );
});

test('routes/staff.js: POST /admin-users tiene authorizeMongoPermission', () => {
  const router = loadRouter('../routes/staff');
  const handlers = getRouteHandlers(router, 'POST', '/admin-users');
  assert.ok(handlers !== null, 'La ruta POST /admin-users debe existir');
  assert.ok(
    hasAuthzMongoPermission(handlers),
    'authorizeMongoPermission debe estar en POST /admin-users',
  );
});
