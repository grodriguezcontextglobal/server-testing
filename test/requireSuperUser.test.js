'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// Los endpoints de observabilidad de jobs (GET /api/jobs/*) cruzan todas las
// compañías (un job de correo, log, etc. no pertenece a una sola compañía de
// forma natural), así que no encajan en authorizeMongoPermission (que exige
// contexto de compañía). Se protegen con un gate simple: solo super_user.
// Mismo patrón de stub de require.cache que authorizeMongoPermission.test.js.

function loadMiddleware(findByIdImpl) {
  const adminUserPath = path.resolve(__dirname, '../models/AdminUser.js');
  const mwPath        = path.resolve(__dirname, '../middlewares/requireSuperUser.js');
  delete require.cache[adminUserPath];
  delete require.cache[mwPath];
  require.cache[adminUserPath] = {
    id: adminUserPath, filename: adminUserPath, loaded: true,
    exports: { findById: findByIdImpl },
  };
  return require('../middlewares/requireSuperUser');
}

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('requireSuperUser: 401 cuando falta req.uid', async () => {
  const { requireSuperUser } = loadMiddleware(() => { throw new Error('no DB'); });
  const res = mockRes();
  let nextCalled = false;

  await requireSuperUser({ params: {} }, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('requireSuperUser: 403 cuando AdminUser no existe', async () => {
  const { requireSuperUser } = loadMiddleware(() => ({ select: () => null }));
  const res = mockRes();
  let nextCalled = false;

  await requireSuperUser({ uid: 'u1' }, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('requireSuperUser: 403 cuando el usuario está inactivo', async () => {
  const { requireSuperUser } = loadMiddleware(() => ({ select: () => ({ active: false, super_user: true }) }));
  const res = mockRes();
  let nextCalled = false;

  await requireSuperUser({ uid: 'u1' }, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('requireSuperUser: 403 cuando el usuario no es super_user', async () => {
  const { requireSuperUser } = loadMiddleware(() => ({ select: () => ({ active: true, super_user: false }) }));
  const res = mockRes();
  let nextCalled = false;

  await requireSuperUser({ uid: 'u1' }, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('requireSuperUser: next() cuando el usuario es super_user activo', async () => {
  const { requireSuperUser } = loadMiddleware(() => ({ select: () => ({ active: true, super_user: true }) }));
  const res = mockRes();
  let nextCalled = false;

  await requireSuperUser({ uid: 'u1' }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test('requireSuperUser: 500 cuando la consulta a AdminUser lanza excepción', async () => {
  const { requireSuperUser } = loadMiddleware(() => ({ select: () => { throw new Error('Mongo down'); } }));
  const res = mockRes();

  await requireSuperUser({ uid: 'u1' }, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
});
