'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// Stub AdminUser.findById y Company.findOne para no requerir conexión MongoDB.
// La fuente de verdad del rol es Company.employees[].roleType, no companiesAssigned.

function loadMiddleware(findAdminUserImpl, findCompanyImpl = () => ({ lean: () => null })) {
  const adminUserPath = path.resolve(__dirname, '../models/AdminUser.js');
  const companyPath   = path.resolve(__dirname, '../models/Company.js');
  const mwPath        = path.resolve(__dirname, '../middlewares/authorizeMongoPermission.js');
  delete require.cache[adminUserPath];
  delete require.cache[companyPath];
  delete require.cache[mwPath];
  require.cache[adminUserPath] = {
    id: adminUserPath, filename: adminUserPath, loaded: true,
    exports: { findById: findAdminUserImpl },
  };
  require.cache[companyPath] = {
    id: companyPath, filename: companyPath, loaded: true,
    exports: { findOne: findCompanyImpl },
  };
  return require('../middlewares/authorizeMongoPermission');
}

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload)  { this.body = payload;   return this; },
  };
}

function baseReq(overrides = {}) {
  return { params: {}, body: {}, query: {}, ...overrides };
}

function makeAdminUser(overrides = {}) {
  return {
    role_type:  'admin',
    super_user: false,
    active:     true,
    ...overrides,
  };
}

// Helper: Company stub que devuelve un employee concreto
function makeCompanyFindOne(employeeData) {
  return () => ({
    lean: () => employeeData
      ? { employees: [employeeData] }
      : null,
  });
}

// ─── 401: sin req.uid ─────────────────────────────────────────────────────────

test('authorizeMongoPermission: 401 cuando falta req.uid', async () => {
  const { authorizeMongoPermission } = loadMiddleware(() => { throw new Error('no DB'); });
  const req = baseReq();
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('inventory', 'create')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(nextCalled, false);
});

// ─── 403: usuario no existe en DB ────────────────────────────────────────────

test('authorizeMongoPermission: 403 cuando AdminUser no existe', async () => {
  const { authorizeMongoPermission } = loadMiddleware(() => ({ select: () => null }));
  const req = baseReq({ uid: 'u1' });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('inventory', 'create')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

// ─── 403: usuario inactivo ────────────────────────────────────────────────────

test('authorizeMongoPermission: 403 cuando usuario está inactivo', async () => {
  const user = makeAdminUser({ active: false });
  const { authorizeMongoPermission } = loadMiddleware(() => ({ select: () => user }));
  const req = baseReq({ uid: 'u1' });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('inventory', 'read')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

// ─── 403: sin company_id → sin contexto de compañía → sin rol ────────────────

test('authorizeMongoPermission: 403 cuando role_type no tiene el permiso (sin company_id)', async () => {
  const user = makeAdminUser({ role_type: 'assistant' });
  const { authorizeMongoPermission } = loadMiddleware(() => ({ select: () => user }));
  const req = baseReq({ uid: 'u1' }); // sin company_id
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('inventory', 'create')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.match(res.body.msg, /insufficient permissions/i);
  assert.equal(nextCalled, false);
});

// ─── 403: sin company_id, otro resource → sin rol ────────────────────────────

test('authorizeMongoPermission: 403 cuando role_type es null y no hay company_id', async () => {
  const user = makeAdminUser({ role_type: null });
  const { authorizeMongoPermission } = loadMiddleware(() => ({ select: () => user }));
  const req = baseReq({ uid: 'u1' });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('event', 'read')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

// ─── sin company_id → 403 (el rol es SIEMPRE por-compañía) ────────────────────

test('authorizeMongoPermission: sin company_id → 403 aunque AdminUser.role_type diera permiso', async () => {
  // El rol NO se toma de AdminUser: sin contexto de compañía no hay rol → deniega.
  const user = makeAdminUser({ role_type: 'admin' }); // admin tendría inventory:create
  const { authorizeMongoPermission } = loadMiddleware(() => ({ select: () => user }));
  const req = baseReq({ uid: 'u1' }); // sin company_id
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('inventory', 'create')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

// ─── super_user global → bypass ──────────────────────────────────────────────

test('authorizeMongoPermission: super_user global = true → next() sin importar el permiso', async () => {
  const user = makeAdminUser({ role_type: 'assistant', super_user: true });
  const { authorizeMongoPermission } = loadMiddleware(() => ({ select: () => user }));
  const req = baseReq({ uid: 'u1' });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('inventory', 'delete')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.isSuperUser, true);
});

// ─── Company.employees: usa roleType del employee para la compañía ────────────

test('authorizeMongoPermission: usa roleType de Company.employees cuando hay company_id', async () => {
  // admin global solo tiene assistant; el employee en comp-1 tiene inventory_manager
  const user = makeAdminUser({ role_type: 'assistant' });
  const empStub = { userId: 'u1', roleType: 'inventory_manager', super_user: false, active: true };

  const { authorizeMongoPermission } = loadMiddleware(
    () => ({ select: () => user }),
    makeCompanyFindOne(empStub),
  );

  const req = baseReq({ uid: 'u1', body: { company_id: 'comp-1' } });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('inventory', 'delete')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.adminRoleType, 'inventory_manager');
  assert.equal(req.isSuperUser, false);
});

// ─── Company.employees: match por EMAIL cuando el employee no tiene userId ────
// Caso real (grodriguez): AdminUser.role_type = null, pero es root_admin en la
// compañía. El employee NO tiene userId backfilled, solo `user` (email).

test('authorizeMongoPermission: matchea employee por email cuando falta userId', async () => {
  const user = makeAdminUser({ role_type: null, email: 'grodriguez@contextglobal.com' });
  // La compañía trae varios employees; el nuestro NO es el primero y NO tiene userId.
  // Debe encontrarse por `user` (email), no por posición ni por userId.
  const findCompany = () => ({
    lean: () => ({
      employees: [
        { user: 'cacaminero@contextglobal.com', roleType: 'root_admin', super_user: true, active: true },
        { user: 'someone@else.com',              roleType: 'assistant',  super_user: false, active: true },
        { user: 'grodriguez@contextglobal.com',  roleType: 'root_admin', super_user: false, active: true }, // sin userId
      ],
    }),
  });

  const { authorizeMongoPermission } = loadMiddleware(
    () => ({ select: () => user }),
    findCompany,
  );

  const req = baseReq({ uid: 'u-mongo-1', body: { company_id: 'comp-bridges' } });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('staff', 'read')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.adminRoleType, 'root_admin');
  assert.equal(req.isSuperUser, false);
});

// ─── Company context via header x-company-id ──────────────────────────────────
// El frontend puede mandar el company_id (Mongo) como header en vez de body/query.

test('authorizeMongoPermission: lee company_id del header x-company-id', async () => {
  const user = makeAdminUser({ role_type: null, email: 'grodriguez@contextglobal.com' });
  const empStub = {
    user: 'grodriguez@contextglobal.com',
    roleType: 'root_admin',
    super_user: false,
    active: true,
  };

  const { authorizeMongoPermission } = loadMiddleware(
    () => ({ select: () => user }),
    makeCompanyFindOne(empStub),
  );

  // Sin company_id en params/body/query — solo en el header.
  const req = baseReq({
    uid: 'u-mongo-1',
    headers: { 'x-company-id': 'comp-bridges' },
    header(name) { return this.headers[name]; },
  });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('staff', 'read')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.adminRoleType, 'root_admin');
});

// ─── Company.employees: super_user en employee → bypass ──────────────────────

test('authorizeMongoPermission: super_user en Company.employees → bypass', async () => {
  const user = makeAdminUser({ role_type: 'assistant' });
  const empStub = { userId: 'u1', roleType: 'assistant', super_user: true, active: true };

  const { authorizeMongoPermission } = loadMiddleware(
    () => ({ select: () => user }),
    makeCompanyFindOne(empStub),
  );

  const req = baseReq({ uid: 'u1', params: { company_id: 'comp-2' } });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('company', 'delete')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.isSuperUser, true);
});

// ─── Company.employees: employee inactivo → deniega (no usa mirror global) ────

test('authorizeMongoPermission: employee inactivo en Company → 403 (no usa mirror global)', async () => {
  const user = makeAdminUser({ role_type: 'assistant' });
  const empStub = { userId: 'u1', roleType: 'root_admin', super_user: false, active: false };

  const { authorizeMongoPermission } = loadMiddleware(
    () => ({ select: () => user }),
    makeCompanyFindOne(empStub),
  );

  const req = baseReq({ uid: 'u1', body: { company_id: 'comp-3' } });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('inventory', 'create')(req, res, () => { nextCalled = true; });

  // assistant no tiene inventory:create → 403
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

// ─── Company.employees: empresa no encontrada → usa role_type global ──────────

test('authorizeMongoPermission: company_id provisto pero no encontrado → 403 (NO usa mirror global)', async () => {
  // Seguridad: con contexto de compañía, el rol debe salir de esa compañía.
  // Aunque el mirror global sea admin, si la compañía no existe/no hay membresía → deniega.
  const user = makeAdminUser({ role_type: 'admin' });
  const { authorizeMongoPermission } = loadMiddleware(
    () => ({ select: () => user }),
    makeCompanyFindOne(null), // company no encontrada
  );

  const req = baseReq({ uid: 'u1', body: { company_id: 'comp-x' } });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('inventory', 'create')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

// ─── Seguridad: cross-tenant — miembro de otra compañía no escala vía mirror ──

test('authorizeMongoPermission: company_id de compañía ajena → 403 aunque el mirror global sea root_admin', async () => {
  const user = makeAdminUser({ role_type: 'root_admin', email: 'gus@x.com' });
  // La compañía existe pero el usuario NO figura entre sus employees.
  const otherCompanyEmp = { user: 'someoneelse@y.com', userId: 'other', roleType: 'root_admin', active: true };

  const { authorizeMongoPermission } = loadMiddleware(
    () => ({ select: () => user }),
    makeCompanyFindOne(otherCompanyEmp),
  );

  const req = baseReq({ uid: 'u1', body: { company_id: 'comp-ajena' } });
  const res = mockRes();
  let nextCalled = false;

  await authorizeMongoPermission('staff', 'read')(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

// ─── 500: error de DB ─────────────────────────────────────────────────────────

test('authorizeMongoPermission: 500 cuando findById lanza excepción', async () => {
  const { authorizeMongoPermission } = loadMiddleware(() => ({
    select: () => { throw new Error('Mongo down'); },
  }));
  const req = baseReq({ uid: 'u1' });
  const res = mockRes();

  await authorizeMongoPermission('event', 'read')(req, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
});
