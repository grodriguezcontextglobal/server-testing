'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

const { corsOptions, ACCEPTED_ORIGINS } = require('../config/cors');

// Los headers custom que el frontend envía DEBEN estar en allowedHeaders,
// o el navegador bloquea el request en el preflight (cross-origin).
const REQUIRED_HEADERS = [
  'x-token',
  'x-csrf-token',   // sesión por cookie, fase 1 (SC-23, AC-12)
  'x-company-id',   // company_id Mongo (authorizeMongoPermission)
  's-company-lq',   // company_id SQL (rutas /api/db_*)
  'x-request-id',
  'x-request-timestamp',
  'x-timezone',
  'idempotency-key', // dedup de mutaciones (upload de documento, pagos)
];

test('cors: allowedHeaders incluye todos los headers del contrato (case-insensitive)', () => {
  const allowed = corsOptions.allowedHeaders.map((h) => h.toLowerCase());
  for (const h of REQUIRED_HEADERS) {
    assert.ok(
      allowed.includes(h.toLowerCase()),
      `Falta "${h}" en corsOptions.allowedHeaders → el preflight lo bloqueará`,
    );
  }
});

// CM-7: una cabecera que ya nadie manda es superficie que sigue abierta. El
// dashboard dejó de enviar `s-token-lq` en su #56 y lo guarda con su propio
// test; aquí se guarda el otro extremo, para que no vuelva por copiar y pegar.
test('cors: s-token-lq ya no está en el contrato', () => {
  const allowed = corsOptions.allowedHeaders.map((h) => h.toLowerCase());
  assert.ok(
    !allowed.includes('s-token-lq'),
    's-token-lq volvió a corsOptions.allowedHeaders: nada del servidor lo lee',
  );
});

test('cors: el origin del frontend local está permitido', () => {
  let allowed = false;
  corsOptions.origin('http://localhost:5522', (err, ok) => { allowed = !err && ok; });
  assert.equal(allowed, true);
});

// El console de plataforma (2026-11-19). Entrada propia a proposito: es la
// unica pantalla que lee datos de todos los clientes, asi que quitarle el acceso
// no puede obligar a tocar el origen del dashboard.
test('cors: el origin del console de plataforma esta permitido', () => {
  let allowed = false;
  corsOptions.origin('https://ops.devitrak.net', (err, ok) => { allowed = !err && ok; });
  assert.equal(allowed, true);
  // Y sigue siendo una entrada distinta de la del dashboard.
  assert.ok(ACCEPTED_ORIGINS.includes('https://admin.devitrak.net'));
});

// ───────────────────────────── cabeceras de respuesta legibles ──────────────
//
// El otro extremo del contrato: no basta con que el servidor MANDE una
// cabecera, el navegador solo deja leer siete sin permiso explicito. Las del
// limitador llevaban desde siempre en el cable y ninguna llegaba al dashboard
// (medido el 2026-11-24). Ver el comentario de `exposedHeaders` en config/cors.js.
const EXPOSED_RATE_LIMIT_HEADERS = [
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'ratelimit-policy',
  'retry-after',
];

test('cors: las cabeceras del limitador son legibles por el navegador', () => {
  assert.ok(
    Array.isArray(corsOptions.exposedHeaders),
    'corsOptions.exposedHeaders no existe: el navegador no puede leer NINGUNA cabecera nuestra',
  );
  const exposed = corsOptions.exposedHeaders.map((h) => h.toLowerCase());
  for (const h of EXPOSED_RATE_LIMIT_HEADERS) {
    assert.ok(
      exposed.includes(h),
      `Falta "${h}" en corsOptions.exposedHeaders → el cliente recibe el 429 sin saber cuando reintentar`,
    );
  }
});

// Y el tripwire que de verdad importa: exponer cabeceras que nadie emite no
// sirve de nada, y emitirlas sin exponerlas es el fallo que acabamos de
// arreglar. Los dos limitadores tienen que seguir escribiendo el estandar
// (`RateLimit-*`) y no el formato viejo (`X-RateLimit-*`), que no esta en la
// lista de arriba y volveria a dejar al navegador a ciegas, en silencio.
const fs = require('node:fs');
const path = require('node:path');

for (const file of ['index.js', 'routes/assistant.js']) {
  test(`cors: el limitador de ${file} emite cabeceras estandar, que son las expuestas`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(
      source,
      /standardHeaders:\s*true/,
      `${file} dejo de emitir RateLimit-* → lo que config/cors.js expone ya no existe`,
    );
    assert.doesNotMatch(
      source,
      /legacyHeaders:\s*true/,
      `${file} volvio a X-RateLimit-* → no esta en exposedHeaders y el navegador no lo vera`,
    );
  });
}

test('cors: un origin no listado es rechazado', () => {
  let errored = false;
  corsOptions.origin('http://evil.example.com', (err) => { errored = !!err; });
  assert.equal(errored, true);
  assert.ok(ACCEPTED_ORIGINS.length > 0);
});
