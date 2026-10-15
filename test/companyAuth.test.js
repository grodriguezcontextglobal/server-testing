'use strict';

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

// ─── Stub: logger ────────────────────────────────────────────────────────────
// Kept out of require.cache-hiding territory on purpose: this is a LOCAL
// module, so faking it says nothing about whether a third-party package loads
// (see test/dependencyLoad.test.js). Here it also lets us assert what got
// logged, which is the whole point of `warn` mode.
const logged = [];
const loggerPath = require.resolve('../helpers/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: {
    warn: (message, detail) => logged.push({ message, detail }),
    info: () => {},
    error: () => {},
    http: () => {},
  },
};

const UID = '507f1f77bcf86cd799439011';
const validToken = () =>
  jwt.sign({ uid: UID, name: 'Ana' }, process.env.SECRET_JWT_SEED, { expiresIn: '2h' });

const makeRequest = ({ path = '/new', method = 'POST', token } = {}) => ({
  path,
  method,
  ip: '203.0.113.7',
  header: (name) => {
    if (name === 'x-token') return token;
    if (name === 'origin') return 'https://admin.devitrak.net';
    return undefined;
  },
});

const makeResponse = () => {
  const response = { statusCode: null, body: null };
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (payload) => {
    response.body = payload;
    return response;
  };
  return response;
};

/** Reload the module under a given mode; `undefined` means the variable is unset. */
const loadWithMode = (mode) => {
  const modulePath = require.resolve('../middlewares/companyAuth');
  const previous = process.env.COMPANY_AUTH_MODE;
  if (mode === undefined) delete process.env.COMPANY_AUTH_MODE;
  else process.env.COMPANY_AUTH_MODE = mode;
  delete require.cache[modulePath];
  const loaded = require('../middlewares/companyAuth');
  delete require.cache[modulePath];
  if (previous === undefined) delete process.env.COMPANY_AUTH_MODE;
  else process.env.COMPANY_AUTH_MODE = previous;
  return loaded;
};

const run = (middleware, request) => {
  const response = makeResponse();
  let nexted = false;
  middleware(request, response, () => {
    nexted = true;
  });
  return { response, nexted };
};

/* ------------------------------------------------------------------ *
 * El default no puede romper nada
 * ------------------------------------------------------------------ */

test('un COMPANY_AUTH_MODE sin definir observa, no rechaza', () => {
  // Se afirma recargando con la variable BORRADA en vez de confiar en el
  // import de arriba: un .env local la define y este test pasaria por el
  // motivo equivocado.
  const { requireCompanyAuth } = loadWithMode(undefined);
  logged.length = 0;

  const { response, nexted } = run(requireCompanyAuth, makeRequest({ path: '/new' }));

  assert.strictEqual(nexted, true, 'warn debe dejar pasar');
  assert.strictEqual(response.statusCode, null, 'warn no responde nada');
  assert.strictEqual(logged.length, 1, 'pero deja constancia');
  assert.match(logged[0].message, /mode=warn/);
  assert.deepStrictEqual(
    { route: logged[0].detail.route, method: logged[0].detail.method },
    { route: '/new', method: 'POST' },
    'el log debe nombrar la ruta y el metodo: es la lista que se lee antes de enforce'
  );
});

test('warn registra el origin y la IP, que es lo que identifica al llamante', () => {
  const { requireCompanyAuth } = loadWithMode('warn');
  logged.length = 0;

  run(requireCompanyAuth, makeRequest({ path: '/provider-upload-document/68f0' }));

  assert.strictEqual(logged[0].detail.origin, 'https://admin.devitrak.net');
  assert.strictEqual(logged[0].detail.ip, '203.0.113.7');
});

/* ------------------------------------------------------------------ *
 * enforce
 * ------------------------------------------------------------------ */

test('enforce: sin token responde 401 y no llama al handler', () => {
  const { requireCompanyAuth } = loadWithMode('enforce');
  const { response, nexted } = run(
    requireCompanyAuth,
    makeRequest({ path: '/provider-upload-document/68f0' })
  );

  assert.strictEqual(nexted, false, 'la subida anonima a S3 no debe ejecutarse');
  assert.strictEqual(response.statusCode, 401);
  assert.strictEqual(response.body.ok, false);
});

test('enforce: un token valido pasa y queda registrado en la request', () => {
  const { requireCompanyAuth } = loadWithMode('enforce');
  const request = makeRequest({ path: '/new', token: validToken() });
  const { response, nexted } = run(requireCompanyAuth, request);

  assert.strictEqual(nexted, true);
  assert.strictEqual(response.statusCode, null);
  assert.strictEqual(request.companySession.uid, UID);
  assert.strictEqual(request.user, undefined, 'req.user se deja intacto: validateJWT es su dueno');
});

test('enforce: un token caducado o forjado es lo mismo que no tener token', () => {
  const { requireCompanyAuth } = loadWithMode('enforce');

  const expired = jwt.sign({ uid: UID }, process.env.SECRET_JWT_SEED, { expiresIn: -10 });
  assert.strictEqual(run(requireCompanyAuth, makeRequest({ token: expired })).response.statusCode, 401);

  const forged = jwt.sign({ uid: UID }, 'otra-semilla', { expiresIn: '2h' });
  assert.strictEqual(run(requireCompanyAuth, makeRequest({ token: forged })).response.statusCode, 401);

  assert.strictEqual(run(requireCompanyAuth, makeRequest({ token: 'no-es-un-jwt' })).response.statusCode, 401);
});

/* ------------------------------------------------------------------ *
 * PUBLIC_ROUTES
 * ------------------------------------------------------------------ */

test('enforce: las rutas exentas pasan sin token, incluida la que lleva :id', () => {
  const { requireCompanyAuth } = loadWithMode('enforce');

  const conParam = run(
    requireCompanyAuth,
    makeRequest({ path: '/update-company/register-process/507f1f77bcf86cd799439011', method: 'PATCH' })
  );
  assert.strictEqual(conParam.nexted, true, 'el registro de compania no tiene sesion todavia');
  assert.strictEqual(conParam.response.statusCode, null);

  const literal = run(requireCompanyAuth, makeRequest({ path: '/consumer-signatures' }));
  assert.strictEqual(literal.nexted, true);
});

// app.devitrak.net nunca manda token (devitrak/src/devitrakApi.jsx no tiene
// interceptor). Estas son TODAS las rutas de /api/company que llama: si una
// falta en PUBLIC_ROUTES, enforce rompe la app del consumidor.
test('enforce: todas las rutas de /api/company que llama la app del consumidor pasan sin token', () => {
  const { requireCompanyAuth } = loadWithMode('enforce');
  for (const [method, path] of [
    ['POST', '/search-company'],
    ['PATCH', '/update-signatures'],
    ['POST', '/event-consumer-signatures'],
  ]) {
    const { nexted, response } = run(requireCompanyAuth, makeRequest({ path, method }));
    assert.strictEqual(nexted, true, `${method} ${path} debe responder sin token`);
    assert.strictEqual(response.statusCode, null);
  }
});

test('enforce: la exencion con :id no se desborda a rutas vecinas', () => {
  // El riesgo de exentar por patron es dejar abierto de mas. `/update-company/:id`
  // es la UNICA ruta del fichero que ya estaba autenticada, asi que si el regex
  // la cubriera por accidente estariamos quitando la unica proteccion que habia.
  const { requireCompanyAuth } = loadWithMode('enforce');

  const vecina = run(
    requireCompanyAuth,
    makeRequest({ path: '/update-company/507f1f77bcf86cd799439011', method: 'PATCH' })
  );
  assert.strictEqual(vecina.response.statusCode, 401, '/update-company/:id NO esta exenta');

  const masProfunda = run(
    requireCompanyAuth,
    makeRequest({ path: '/update-company/register-process/abc/extra' })
  );
  assert.strictEqual(masProfunda.response.statusCode, 401, 'un segmento extra no cuela');
});

test('cada exencion declara por que lo esta', () => {
  const { PUBLIC_ROUTES } = loadWithMode(undefined);
  assert.ok(PUBLIC_ROUTES.length > 0);
  for (const [matcher, reason] of PUBLIC_ROUTES) {
    assert.ok(
      typeof reason === 'string' && reason.length > 20,
      `la exencion ${matcher} deberia explicar su motivo`
    );
  }
});

/* ------------------------------------------------------------------ *
 * Cableado: que el middleware este MONTADO, no solo que funcione
 * ------------------------------------------------------------------ */

test('routes/company.js monta requireCompanyAuth antes de todas sus rutas', () => {
  // Que el middleware sea correcto no sirve de nada si no esta enganchado. Se
  // inspecciona el stack real del Router en vez de confiar en que el import
  // este puesto: un `router.use` mal colocado (despues de las rutas) dejaria
  // sin cubrir justo lo que se queria cubrir.
  const router = require('../routes/company');

  const primerMiddleware = router.stack.findIndex(
    (layer) => !layer.route && layer.handle && layer.handle.name === 'requireCompanyAuth'
  );
  assert.notStrictEqual(primerMiddleware, -1, 'requireCompanyAuth no esta montado en el router');

  const primeraRuta = router.stack.findIndex((layer) => layer.route);
  assert.notStrictEqual(primeraRuta, -1, 'el router deberia tener rutas');
  assert.ok(
    primerMiddleware < primeraRuta,
    'requireCompanyAuth debe ir ANTES de la primera ruta, o no las cubre'
  );
});

/* ------------------------------------------------------------------ *
 * off
 * ------------------------------------------------------------------ */

test('off desactiva el chequeo por completo, sin log', () => {
  const { requireCompanyAuth } = loadWithMode('off');
  logged.length = 0;

  const { response, nexted } = run(requireCompanyAuth, makeRequest({ path: '/new' }));

  assert.strictEqual(nexted, true);
  assert.strictEqual(response.statusCode, null);
  assert.strictEqual(logged.length, 0, 'off es rollback: ni bloquea ni ensucia el log');
});

test('un valor desconocido en la variable se comporta como warn, no como off', () => {
  // Un typo en el .env no debe abrir el namespace ni cerrarlo: debe observar.
  const { requireCompanyAuth } = loadWithMode('ENFORCE_TYPO');
  logged.length = 0;

  const { response, nexted } = run(requireCompanyAuth, makeRequest({ path: '/new' }));

  assert.strictEqual(nexted, true);
  assert.strictEqual(response.statusCode, null);
  assert.strictEqual(logged.length, 1);
});
