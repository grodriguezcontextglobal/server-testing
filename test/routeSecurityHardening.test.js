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

test('mysql/routes/company.js: POST /locations tiene validateJWT + authorizePermission', () => {
  const router = loadRouter('../mysql/routes/company');
  const handlers = getRouteHandlers(router, 'POST', '/locations');
  assert.ok(handlers !== null, 'La ruta POST /locations debe existir');
  assert.ok(handlers.includes(validateJWT), 'validateJWT debe estar en POST /locations');
  assert.ok(hasAuthzPermission(handlers), 'authorizePermission debe estar en POST /locations');
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

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE I — endpoints bulk de inventario sin auth (insertBulkItem/container)
// RED: las tres eran públicas -- sin validateJWT, sin scoping por company_id.
// insertBulkItem valida company_id en el body -> puede llevar authorizePermission.
// Los endpoints de container operan por container_item_id sin company_id
// disponible en body/params -- solo requieren login (validateJWT) por ahora;
// el scoping real necesita un join a item_inv para derivar el company_id
// dueño del container (ver nota en mysql/routes/inventory.js).
// ════════════════════════════════════════════════════════════════════════════

test('mysql/routes/item.js: POST /bulk-item tiene authorizePermission', () => {
  const router = loadRouter('../mysql/routes/item');
  const handlers = getRouteHandlers(router, 'POST', '/bulk-item');
  assert.ok(handlers !== null, 'La ruta POST /bulk-item debe existir');
  assert.ok(handlers.includes(validateJWT), 'validateJWT debe estar en POST /bulk-item');
  assert.ok(hasAuthzPermission(handlers), 'authorizePermission debe estar en POST /bulk-item');
});

test('mysql/routes/item.js: POST /item-out-warehouse tiene validateJWT + authorizePermission', () => {
  const router = loadRouter('../mysql/routes/item');
  const handlers = getRouteHandlers(router, 'POST', '/item-out-warehouse');
  assert.ok(handlers !== null, 'La ruta POST /item-out-warehouse debe existir');
  assert.ok(handlers.includes(validateJWT), 'validateJWT debe estar en POST /item-out-warehouse');
  assert.ok(hasAuthzPermission(handlers), 'authorizePermission debe estar en POST /item-out-warehouse');
});

test('mysql/routes/inventory.js: POST /container-items tiene validateJWT', () => {
  const router = loadRouter('../mysql/routes/inventory');
  const handlers = getRouteHandlers(router, 'POST', '/container-items');
  assert.ok(handlers !== null, 'La ruta POST /container-items debe existir');
  assert.ok(handlers.includes(validateJWT), 'validateJWT debe estar en POST /container-items');
});

test('mysql/routes/inventory.js: PUT /container/:container_item_id tiene validateJWT', () => {
  const router = loadRouter('../mysql/routes/inventory');
  const handlers = getRouteHandlers(router, 'PUT', '/container/:container_item_id');
  assert.ok(handlers !== null, 'La ruta PUT /container/:container_item_id debe existir');
  assert.ok(handlers.includes(validateJWT), 'validateJWT debe estar en PUT /container/:container_item_id');
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE — rutas de contenedor en evento (mysql/routes/events.js)
// RED: las dos eran anónimas mientras su hermana /allocate-device-event ya
// estaba gateada, y las dos escriben (UPDATE item_inv + INSERT al evento).
// Además, sin validateJWT el job que encola /inserting-items-in-event-from-container
// queda sin dueño (context.uid = null) y GET /api/jobs/owned/:jobId responde 404
// para el jobId que el propio endpoint acaba de devolver.
// ════════════════════════════════════════════════════════════════════════════

test('mysql/routes/events.js: POST /inserting-items-in-event-from-container tiene validateJWT', () => {
  const router = loadRouter('../mysql/routes/events');
  const handlers = getRouteHandlers(router, 'POST', '/inserting-items-in-event-from-container');
  assert.ok(handlers !== null, 'La ruta POST /inserting-items-in-event-from-container debe existir');
  assert.ok(
    handlers.includes(validateJWT),
    'validateJWT debe estar en POST /inserting-items-in-event-from-container (si no, el job queda sin dueño)',
  );
});

test('mysql/routes/events.js: POST /allocate-device-container-event tiene validateJWT', () => {
  const router = loadRouter('../mysql/routes/events');
  const handlers = getRouteHandlers(router, 'POST', '/allocate-device-container-event');
  assert.ok(handlers !== null, 'La ruta POST /allocate-device-container-event debe existir');
  assert.ok(
    handlers.includes(validateJWT),
    'validateJWT debe estar en POST /allocate-device-container-event',
  );
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE — /inventory-based-on-submitted-parameters (las 3 rutas)
//
// consultingCompanyInventoryBasedOnSubmittedParameters EJECUTA el SQL que
// viene en el body de la request. El mismo handler está montado en tres
// routers y dos de ellos (db_event, db_item) estaban SIN autenticación
// alguna: cualquiera en internet podía correr sentencias arbitrarias contra
// producción. Estos tests fijan que las tres rutas queden autenticadas.
// ════════════════════════════════════════════════════════════════════════════

const { checkTokenVersion } = require('../middlewares/checkValidateToken');

const RAW_QUERY_ROUTE = '/inventory-based-on-submitted-parameters';

for (const routerPath of [
  '../mysql/routes/company',
  '../mysql/routes/events',
  '../mysql/routes/item',
]) {
  test(`${routerPath}: POST ${RAW_QUERY_ROUTE} exige validateJWT + checkTokenVersion`, () => {
    const router = loadRouter(routerPath);
    const handlers = getRouteHandlers(router, 'POST', RAW_QUERY_ROUTE);
    assert.ok(handlers !== null, `La ruta POST ${RAW_QUERY_ROUTE} debe existir en ${routerPath}`);
    assert.ok(
      handlers.includes(validateJWT),
      `validateJWT debe estar en POST ${RAW_QUERY_ROUTE} de ${routerPath} — este handler ejecuta SQL del cliente`,
    );
    assert.ok(
      handlers.includes(checkTokenVersion),
      `checkTokenVersion debe estar en POST ${RAW_QUERY_ROUTE} de ${routerPath} — sin él una sesión revocada sigue ejecutando SQL`,
    );
  });
}

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE F — rutas anónimas sobre item_inv (2026-09-15)
// Las cinco iban sin token: dos vuelcan inventario de cualquier compañía y dos
// escriben sobre la estructura de locaciones.
// ════════════════════════════════════════════════════════════════════════════

const ANON_CLOSED = [
  ['../mysql/routes/item',         'POST', '/items_information'],
  ['../mysql/routes/item',         'POST', '/inventory-pagination'],
  ['../mysql/routes/company',      'POST', '/company-inventory-pagination'],
  ['../mysql/routes/inventory',    'POST', '/update-location-sub-location'],
  ['../mysql/routes/sub_location', 'PUT',  '/sub-locations/:id'],
  ['../mysql/routes/sub_location', 'DELETE', '/sub-locations/:id'],
];

for (const [file, method, path] of ANON_CLOSED) {
  test(`${file}: ${method} ${path} exige validateJWT`, () => {
    const router = loadRouter(file);
    const handlers = getRouteHandlers(router, method, path);
    assert.ok(handlers !== null, `La ruta ${method} ${path} debe existir`);
    assert.ok(
      handlers.includes(validateJWT),
      `validateJWT debe estar en ${method} ${path}`,
    );
  });
}

test('las dos escrituras de locación exigen ademas permiso de inventario', () => {
  for (const [file, method, path] of ANON_CLOSED.slice(3)) {
    const handlers = getRouteHandlers(loadRouter(file), method, path);
    assert.ok(hasAuthzPermission(handlers), `authorizePermission debe estar en ${method} ${path}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE F — checkTokenVersion en las lecturas de inventario endurecidas
//
// Estas seis rutas recibieron validateJWT al cerrarse las rutas anónimas, pero
// se quedaron SIN checkTokenVersion, a diferencia del resto de rutas
// endurecidas. El efecto es que un force-logout no revoca el acceso a ellas:
// el token viejo sigue leyendo inventario hasta que expire por su cuenta.
// ════════════════════════════════════════════════════════════════════════════

const INVENTORY_READ_ROUTES = [
  ['../mysql/routes/item', 'POST', '/inventory-page'],
  ['../mysql/routes/item', 'POST', '/inventory-facets'],
  ['../mysql/routes/item', 'GET', '/serial-suggest'],
  ['../mysql/routes/item', 'POST', '/items_information'],
  ['../mysql/routes/item', 'POST', '/inventory-pagination'],
  ['../mysql/routes/company', 'POST', '/company-inventory-pagination'],
];

for (const [modulePath, method, routePath] of INVENTORY_READ_ROUTES) {
  test(`${modulePath}: ${method} ${routePath} lleva validateJWT y checkTokenVersion`, () => {
    const router = loadRouter(modulePath);
    const handlers = getRouteHandlers(router, method, routePath);
    assert.ok(handlers !== null, `La ruta ${method} ${routePath} debe existir`);
    assert.ok(
      handlers.includes(validateJWT),
      `validateJWT debe estar en la cadena de ${method} ${routePath}`,
    );
    assert.ok(
      handlers.includes(checkTokenVersion),
      `checkTokenVersion debe estar en la cadena de ${method} ${routePath}`,
    );
  });
}

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE G — borrado de sub-locación (mysql/routes/location.js, 2026-09-22)
//
// POST /sub-location-path/delete borra la ruta y TODO su subárbol de
// company_sub_location_paths. Se añadió sin validateJWT, leyendo company_id del
// body: cualquiera que alcanzara el host podía borrar el árbol de sub-locaciones
// de cualquier compañía. El hermano destructivo del mismo fichero
// (POST /locations/:id -> deleteLocation) sigue anónimo y ya provocó el borrado
// de location_id = 1 en producción durante una auditoría; ese queda aparte.
//
// authorizePermission no reemplaza el company_id del body: lo comprueba contra
// company_staff para el llamante autenticado, así que deja de ser una afirmación
// que se acepta tal cual.
// ════════════════════════════════════════════════════════════════════════════

test('mysql/routes/location.js: POST /sub-location-path/delete lleva validateJWT, checkTokenVersion y authorizePermission', () => {
  const router = loadRouter('../mysql/routes/location');
  const handlers = getRouteHandlers(router, 'POST', '/sub-location-path/delete');
  assert.ok(handlers !== null, 'La ruta POST /sub-location-path/delete debe existir');
  assert.ok(
    handlers.includes(validateJWT),
    'validateJWT debe estar en la cadena de POST /sub-location-path/delete',
  );
  assert.ok(
    handlers.includes(checkTokenVersion),
    'checkTokenVersion debe estar en la cadena de POST /sub-location-path/delete',
  );
  assert.ok(
    hasAuthzPermission(handlers),
    'authorizePermission debe estar en la cadena de POST /sub-location-path/delete',
  );
});

test('mysql/routes/location.js: POST /locations/:id lleva validateJWT, checkTokenVersion y authorizePermission', () => {
  const router = loadRouter('../mysql/routes/location');
  const handlers = getRouteHandlers(router, 'POST', '/locations/:id');
  assert.ok(handlers !== null, 'La ruta POST /locations/:id debe existir');
  assert.ok(
    handlers.includes(validateJWT),
    'validateJWT debe estar en la cadena de POST /locations/:id',
  );
  assert.ok(
    handlers.includes(checkTokenVersion),
    'checkTokenVersion debe estar en la cadena de POST /locations/:id',
  );
  assert.ok(
    hasAuthzPermission(handlers),
    'authorizePermission debe estar en la cadena de POST /locations/:id',
  );
});

test('mysql/routes/location.js: POST /sub-location-path lleva validateJWT, checkTokenVersion y authorizePermission', () => {
  const router = loadRouter('../mysql/routes/location');
  const handlers = getRouteHandlers(router, 'POST', '/sub-location-path');
  assert.ok(handlers !== null, 'La ruta POST /sub-location-path debe existir');
  assert.ok(
    handlers.includes(validateJWT),
    'validateJWT debe estar en la cadena de POST /sub-location-path',
  );
  assert.ok(
    handlers.includes(checkTokenVersion),
    'checkTokenVersion debe estar en la cadena de POST /sub-location-path',
  );
  assert.ok(
    hasAuthzPermission(handlers),
    'authorizePermission debe estar en la cadena de POST /sub-location-path',
  );
});

// Resto de mysql/routes/location.js (2026-09-23). Las dos escrituras que
// quedaban anónimas y los dos árboles de lectura, que exponían la estructura
// interna de locaciones de cualquier inquilino a quien la pidiera.
const LOCATION_ROUTES = [
  ['POST',   '/locations'],
  ['PUT',    '/locations/:id/inventory'],
  ['GET',    '/companies/:company_id/locations/tree'],
  ['GET',    '/companies/:company_id/location-paths-tree'],
];

for (const [method, routePath] of LOCATION_ROUTES) {
  test(`mysql/routes/location.js: ${method} ${routePath} lleva validateJWT, checkTokenVersion y authorizePermission`, () => {
    const router = loadRouter('../mysql/routes/location');
    const handlers = getRouteHandlers(router, method, routePath);
    assert.ok(handlers !== null, `La ruta ${method} ${routePath} debe existir`);
    assert.ok(
      handlers.includes(validateJWT),
      `validateJWT debe estar en la cadena de ${method} ${routePath}`,
    );
    assert.ok(
      handlers.includes(checkTokenVersion),
      `checkTokenVersion debe estar en la cadena de ${method} ${routePath}`,
    );
    assert.ok(
      hasAuthzPermission(handlers),
      `authorizePermission debe estar en la cadena de ${method} ${routePath}`,
    );
  });
}

// Red de seguridad: que no vuelva a aparecer una ruta anónima en este fichero.
// Las dos lecturas /companies/:id/locations llevan validateJWT y comprueban el
// scope dentro del controlador (getStaffCompanyAccess), así que se exige token
// pero no authorizePermission.
test('mysql/routes/location.js: ninguna ruta queda sin validateJWT', () => {
  const router = loadRouter('../mysql/routes/location');
  const anonymous = router.stack
    .filter((l) => l.route)
    .filter((l) => !l.route.stack.map((x) => x.handle).includes(validateJWT))
    .map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  assert.deepEqual(anonymous, [], `rutas anónimas: ${anonymous.join(', ')}`);
});
