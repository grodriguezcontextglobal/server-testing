'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { requirePlatformRead } = require('../middlewares/requirePlatformRead');

/**
 * `GET /api/metrics` se registró con `requireSuperUser` pero SIN `validateJWT`.
 *
 * Ese gate se apoya en `req.uid`, y quien lo pone es `validateJWT`. Sin él no es
 * más estricto: es **inalcanzable** — devuelve 401 a todo, token de super_user
 * incluido. La ruta gemela lo hace bien (`routes/jobs.js:23`).
 *
 * Es la misma clase de fallo que los 401 de `authorizePermission`: un middleware
 * que falla cerrado hace que una ruta muerta parezca una ruta protegida, y nadie
 * reporta un 401 como bug.
 *
 * Los tests de `metricsAndReadiness.test.js` cubren el helper y el middleware de
 * instrumentación, no el cableado de la ruta — por eso esto se coló.
 */

const makeRes = () => {
  const sent = {};
  return {
    sent,
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
  };
};

test('requirePlatformRead responde 401 si nadie ha puesto req.uid', async () => {
  const res = makeRes();
  let nextCalled = false;

  await requirePlatformRead({}, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.sent.status, 401);
  assert.equal(
    res.sent.body.ok,
    false,
    'sin validateJWT delante, este gate no deja pasar a NADIE',
  );
});

/**
 * `index.js` no exporta la app —arrancaría el servidor al requerirla—, así que
 * el cableado se comprueba sobre el fuente. Es menos elegante que inspeccionar
 * el stack del router, y es lo que hay: sigue atrapando la regresión concreta,
 * que es que alguien quite `validateJWT` de esa línea.
 */
test('index.js: GET /api/metrics lleva validateJWT ANTES del gate de plataforma', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');

  const registration = source
    .split('\n')
    .find((line) => line.includes('app.get("/api/metrics"'));

  assert.ok(registration, 'la ruta GET /api/metrics debe seguir existiendo');
  assert.match(
    registration,
    /app\.get\("\/api\/metrics",\s*validateJWT,\s*requirePlatformRead/,
    'validateJWT tiene que ir antes del gate, o la ruta responde 401 a todo',
  );
});
