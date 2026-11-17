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

test('cors: un origin no listado es rechazado', () => {
  let errored = false;
  corsOptions.origin('http://evil.example.com', (err) => { errored = !!err; });
  assert.equal(errored, true);
  assert.ok(ACCEPTED_ORIGINS.length > 0);
});
