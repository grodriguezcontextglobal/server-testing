'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// authorizePermission calls getConnection() inside the async handler,
// so we swap the stub between tests by clearing the cache.

function loadMiddleware(queryImpl) {
  const connPath = path.resolve(__dirname, '../mysql/database/config.js');
  const mwPath   = path.resolve(__dirname, '../middlewares/authorizePermission.js');
  delete require.cache[connPath];
  delete require.cache[mwPath];
  require.cache[connPath] = {
    id: connPath, filename: connPath, loaded: true,
    exports: () => ({ query: queryImpl }),
  };
  return require('../middlewares/authorizePermission');
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload)  { this.body = payload;   return this; },
  };
}

function baseReq(overrides = {}) {
  return { params: {}, body: {}, query: {}, ...overrides };
}

// ── 401: sqlStaffId missing ───────────────────────────────────────────────────

test('authorizePermission: 401 cuando falta req.sqlStaffId', async () => {
  const { authorizePermission } = loadMiddleware(() => {
    throw new Error('DB no debe llamarse');
  });
  const req = baseReq({ body: { company_id: 'comp-1' } }); // no sqlStaffId
  const res = mockRes();
  let nextCalled = false;

  await authorizePermission('staff', 'update_contact')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(nextCalled, false);
});

// ── 401: company_id missing ───────────────────────────────────────────────────

test('authorizePermission: 401 cuando falta company_id en body, params y query', async () => {
  const { authorizePermission } = loadMiddleware(() => {
    throw new Error('DB no debe llamarse');
  });
  const req = baseReq({ sqlStaffId: 42 }); // no company_id
  const res = mockRes();
  let nextCalled = false;

  await authorizePermission('staff', 'update_contact')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(nextCalled, false);
});

// ── 403: no permission in SQL ─────────────────────────────────────────────────

test('authorizePermission: 403 cuando SQL no devuelve filas para ese resource/action', async () => {
  const { authorizePermission } = loadMiddleware(async () => [[]]); // empty rows
  const req = baseReq({ sqlStaffId: 42, body: { company_id: 7 } });
  const res = mockRes();
  let nextCalled = false;

  await authorizePermission('inventory', 'create')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /insufficient permissions/);
  assert.equal(nextCalled, false);
});

// ── 200: permission granted → next() ─────────────────────────────────────────

test('authorizePermission: llama next() cuando el permiso existe en SQL', async () => {
  const { authorizePermission } = loadMiddleware(async () => [[{ 1: 1 }]]); // row found
  const req = baseReq({ sqlStaffId: 42, body: { company_id: 7 } });
  const res = mockRes();
  let nextCalled = false;

  await authorizePermission('staff', 'update_contact')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});

// ── company_id from req.query ─────────────────────────────────────────────────

test('authorizePermission: lee company_id desde req.query cuando no está en body/params', async () => {
  const { authorizePermission } = loadMiddleware(async () => [[{ 1: 1 }]]);
  const req = baseReq({ sqlStaffId: 42, query: { company_id: 7 } });
  const res = mockRes();
  let nextCalled = false;

  await authorizePermission('event', 'read')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

// ── company_id from req.params ────────────────────────────────────────────────

test('authorizePermission: lee company_id desde req.params', async () => {
  const captured = [];
  const { authorizePermission } = loadMiddleware(async (sql, params) => {
    captured.push(params);
    return [[{ 1: 1 }]];
  });
  const req = baseReq({ sqlStaffId: 99, params: { company_id: 55 } });
  const res = mockRes();

  await authorizePermission('event', 'update')(req, res, () => {});

  assert.equal(captured[0][0], 55); // company_id from params
  assert.equal(captured[0][1], 99); // sqlStaffId
});

// ── 500: DB error ─────────────────────────────────────────────────────────────

test('authorizePermission: 500 cuando la consulta SQL lanza excepción', async () => {
  const { authorizePermission } = loadMiddleware(async () => { throw new Error('DB down'); });
  const req = baseReq({ sqlStaffId: 42, body: { company_id: 7 } });
  const res = mockRes();

  await authorizePermission('staff', 'read')(req, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
});

// ── s-company-lq como último recurso (2026-09-15) ──────────────────────────
// Motivo: al exigir permiso en /sub-locations/:id, el middleware respondía 401
// "missing company_id" a TODA petición, porque esa ruta identifica el recurso
// por la URL y no lleva company_id en params, body ni query.

const { readCompanyId } = require('../middlewares/authorizePermission');

const reqWith = ({ params = {}, body = {}, query = {}, header } = {}) => ({
  params, body, query,
  header: (name) => (header && name === 's-company-lq' ? header : undefined),
});

test('readCompanyId: params, body y query siguen mandando sobre el header', () => {
  assert.strictEqual(readCompanyId(reqWith({ params: { company_id: 'A' }, header: 'Z' })), 'A');
  assert.strictEqual(readCompanyId(reqWith({ body: { company_id: 'B' }, header: 'Z' })), 'B');
  assert.strictEqual(readCompanyId(reqWith({ query: { company_id: 'C' }, header: 'Z' })), 'C');
});

test('readCompanyId: sin company_id en ninguna fuente, cae al header', () => {
  assert.strictEqual(readCompanyId(reqWith({ header: '62' })), '62');
});

test('readCompanyId: sin header y sin company_id no inventa una compañía', () => {
  assert.strictEqual(readCompanyId(reqWith({})), undefined);
});
