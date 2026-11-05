'use strict';

/**
 * Sesión de staff: 12 h como máximo desde el login (FedRAMP AC-12).
 *
 *   - No hay opción de 30 días: todo token caduca a las 12 h.
 *   - Renovar conserva la hora del login (authTime) y la caducidad: no alarga.
 *   - Una sesión que ya pasó las 12 h no se puede renovar.
 */

process.env.SECRET_JWT_SEED = 'test-seed-session';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { generateJWT, SESSION_MAX_SECONDS } = require('../helpers/jwt');

const now = () => Math.floor(Date.now() / 1000);

test('el máximo es 12 h', () => {
  assert.equal(SESSION_MAX_SECONDS, 12 * 3600);
});

test('un login nuevo caduca a las 12 h y lleva authTime', async () => {
  const t = jwt.decode(await generateJWT('u1', 'Ana', 0, 7));
  assert.ok(Math.abs(t.authTime - now()) <= 1);
  assert.equal(t.exp - t.authTime, SESSION_MAX_SECONDS);
  assert.equal(t.sqlStaffId, 7);
});

test('renovar conserva authTime y la hora de caducidad', async () => {
  const loginAt = now() - 5 * 3600; // login hace 5 h
  const t = jwt.decode(await generateJWT('u1', 'Ana', 0, 7, { authTime: loginAt }));
  assert.equal(t.authTime, loginAt);
  assert.ok(Math.abs(t.exp - (loginAt + SESSION_MAX_SECONDS)) <= 1, 'caduca a las 12 h del login, no 12 h desde ahora');
});

test('una sesión de más de 12 h no se renueva', async () => {
  await assert.rejects(generateJWT('u1', 'Ana', 0, 7, { authTime: now() - 13 * 3600 }));
});

test('un authTime en el futuro no se acepta: cuenta desde ahora', async () => {
  const t = jwt.decode(await generateJWT('u1', 'Ana', 0, 7, { authTime: now() + 3600 }));
  assert.ok(t.authTime <= now());
});
