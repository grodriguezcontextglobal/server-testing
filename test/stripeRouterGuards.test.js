'use strict';

/**
 * Invariantes de la cadena de `routes/stripe.js`.
 *
 * POR QUE EXISTE ESTE FICHERO. Hasta el 2026-09-25 el límite de peticiones y la
 * idempotencia se ponían ruta a ruta, y el recuento hablaba solo: de 46 rutas,
 * 6 tenían limitador y 9 idempotencia. Moverlos al router arregla el pasado; lo
 * que impide que vuelva a pasar es este test, porque una convención que solo
 * vive en la cabeza de quien escribió la ruta anterior no sobrevive a la
 * siguiente.
 *
 * El segundo bloque es igual de importante y menos obvio: comprueba que NADIE
 * los vuelva a poner también en una ruta. Aplicar `idempotencyMutationCache` dos
 * veces no es redundante, es una avería — la segunda pasada encuentra la
 * reserva de la primera y devuelve 409 a una petición perfectamente legítima.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const loadRouter = (relativePath) => {
  const fullPath = path.resolve(__dirname, relativePath);
  delete require.cache[fullPath];
  return require(fullPath);
};

const router = loadRouter('../routes/stripe');

/** Middlewares de router (los de `router.use`), en orden. */
const routerLevel = router.stack.filter((layer) => !layer.route).map((layer) => layer.handle.name);

/** Todas las rutas declaradas, con los nombres de su cadena propia. */
const routes = router.stack
  .filter((layer) => layer.route)
  .map((layer) => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods).map((m) => m.toUpperCase()),
    chain: layer.route.stack.map((l) => l.handle.name),
  }));

/* ---------------------------------------------------------------- *
 * Bloque A — la cadena común existe y está en el orden correcto
 * ---------------------------------------------------------------- */

test('el router aplica optionalJWT, el limitador y la idempotencia a TODAS las rutas', () => {
  assert.ok(routerLevel.includes('optionalJWT'), 'falta optionalJWT a nivel de router');
  assert.ok(routerLevel.includes('publicPaymentRateLimit'), 'falta el limitador a nivel de router');
  assert.ok(routerLevel.includes('idempotencyOnMutations'), 'falta la idempotencia a nivel de router');
});

test('optionalJWT va ANTES del limitador, o el carril autenticado pierde su presupuesto', () => {
  const identity = routerLevel.indexOf('optionalJWT');
  const limiter = routerLevel.indexOf('publicPaymentRateLimit');

  assert.ok(
    identity < limiter,
    'el limitador lee req.authContext.lane: si corre antes de optionalJWT, ' +
      'todo el trafico autenticado cobra el limite del carril publico'
  );
});

test('hay rutas de sobra como para que esto importe', () => {
  assert.ok(routes.length >= 40, `se esperaban 40+ rutas, hay ${routes.length}`);
});

/* ---------------------------------------------------------------- *
 * Bloque B — y nadie los duplica en una ruta concreta
 * ---------------------------------------------------------------- */

test('ninguna ruta vuelve a montar el limitador ni la idempotencia', () => {
  const duplicated = routes.filter((route) =>
    route.chain.some((name) =>
      ['publicPaymentRateLimit', 'idempotencyMutationCache', 'idempotencyOnMutations'].includes(name)
    )
  );

  assert.deepEqual(
    duplicated.map((r) => `${r.methods.join('/')} ${r.path}`),
    [],
    'duplicar la idempotencia hace que la segunda pasada vea la reserva de la primera y responda 409'
  );
});

test('ninguna ruta vuelve a montar optionalJWT', () => {
  const duplicated = routes
    .filter((route) => route.chain.includes('optionalJWT'))
    .map((r) => `${r.methods.join('/')} ${r.path}`);

  assert.deepEqual(duplicated, [], 'optionalJWT ya se aplica a nivel de router');
});

/* ---------------------------------------------------------------- *
 * Bloque C — lo que la cadena comun NO debe tragarse
 * ---------------------------------------------------------------- */

test('las rutas internas conservan su autenticacion propia', () => {
  // La cadena comun es aditiva: da identidad opcional, no sustituye a nadie.
  // Estas cuatro son las gemelas protegidas del carril publico y tienen que
  // seguir exigiendo sesion.
  const internal = routes.filter((route) => route.path.startsWith('/internal/'));

  assert.ok(internal.length >= 4, `se esperaban 4+ rutas internas, hay ${internal.length}`);
  for (const route of internal) {
    // Sin escapatoria: el nombre tiene que estar. Un `|| name === ''` aqui
    // convertiria el test en uno que no puede fallar, porque la cadena lleva
    // una funcion anonima (la que devuelve authorizeMongoPermission).
    assert.ok(route.chain.includes('validateJWT'), `${route.path} perdio su validateJWT`);
    assert.ok(route.chain.includes('checkTokenVersion'), `${route.path} perdio checkTokenVersion`);
  }
});

test('los validadores de payload siguen en las rutas que los tenian', () => {
  const byPath = (p) => routes.find((route) => route.path === p);

  assert.ok(
    byPath('/refund').chain.includes('validateRefundPayload'),
    '/refund perdio la validacion de payload'
  );
  assert.ok(
    byPath('/create-payment-intent').chain.includes('attachServerIdempotencyKey'),
    '/create-payment-intent perdio la clave de idempotencia del servidor'
  );
});
