'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// createCompany usa MongoDB + SQL. Stubamos todos los módulos externos
// ANTES de importar el controlador para que los captures al nivel de módulo
// sean nuestros fakes.

// ─── Registro de llamadas SQL ──────────────────────────────────────────────────
const queryLog = [];

// ─── Stub: SQL connection ─────────────────────────────────────────────────────
const sqlConnPath = require.resolve('../mysql/database/config');
require.cache[sqlConnPath] = {
  id: sqlConnPath, filename: sqlConnPath, loaded: true,
  exports: () => ({
    query: async (sql, params) => {
      queryLog.push({ sql, params });
      if (sql.includes('SELECT id FROM roles'))        return [[{ id: 'role-uuid' }]];
      if (sql.includes('INSERT'))                       return [{ affectedRows: 1 }];
      return [[]];
    },
    execute: async (sql, params) => {
      queryLog.push({ sql, params });
      if (sql.includes('FROM staff_member')) return [[{ staff_id: 74 }]];
      return [[]];
    },
  }),
};

// ─── Stub: Company model ──────────────────────────────────────────────────────
class FakeCompany {
  constructor(data) {
    Object.assign(this, data);
    this._id = { toString: () => 'fake-company-id' };
  }
  async save() { return this; }
}
FakeCompany.findOne = async () => null; // empresa no existe → permite crear

const companyModelPath = require.resolve('../models/Company');
require.cache[companyModelPath] = {
  id: companyModelPath, filename: companyModelPath, loaded: true,
  exports: FakeCompany,
};

// ─── Stub: AdminUser model ────────────────────────────────────────────────────
const FakeAdminUser = {
  findOne: () => ({
    select: () => ({
      lean: () => Promise.resolve({ _id: 'found-user-id' }),
    }),
  }),
};

const adminUserPath = require.resolve('../models/AdminUser');
require.cache[adminUserPath] = {
  id: adminUserPath, filename: adminUserPath, loaded: true,
  exports: FakeAdminUser,
};

// ─── Stub: Redis cache ────────────────────────────────────────────────────────
const redisCachePath = require.resolve('../database/cacheMemoryConfig');
require.cache[redisCachePath] = {
  id: redisCachePath, filename: redisCachePath, loaded: true,
  exports: { clientRedis: async () => ({ del: async () => {} }) },
};

// ─── Stub: Logger ─────────────────────────────────────────────────────────────
const loggerPath = require.resolve('../helpers/logger');
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { error: () => {}, info: () => {}, warn: () => {} },
};

// Ahora sí importamos el controlador
const { createCompany } = require('../controller/company');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload)  { this.body = payload;   return this; },
  };
}

function baseEmployee(overrides = {}) {
  return {
    user:       'founder@test.com',
    firstName:  'Ana',
    lastName:   'López',
    status:     'active',
    super_user: true,
    role:       '0',
    ...overrides,
  };
}

function baseReq(employee) {
  return {
    body: {
      company_name:       'Test Corp',
      address:            { street: '123 Main', city: 'NYC', state: 'NY', postal_code: '10001' },
      phone:              { main: '555-0000', alternative: '' },
      owner:              { first_name: 'Owner', last_name: 'Test', email: 'owner@test.com' },
      website:            'https://test.com',
      main_email:         'info@test.com',
      industry:           'Tech',
      stripe_customer_id: '',
      employees:          [employee],
      location:           [],
      company_logo:       '',
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('createCompany: 201 y sincroniza company_staff SQL cuando roleType y userId son válidos', async () => {
  queryLog.length = 0;

  const req = baseReq(baseEmployee({
    roleType: 'root_admin',
    userId:   'user-mongo-id',
  }));
  const res = mockRes();

  await createCompany(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);

  const selectRoles   = queryLog.find(q => q.sql.includes('SELECT id FROM roles'));
  const selectStaff   = queryLog.find(q => q.sql.includes('FROM staff_member'));
  const insertStaff   = queryLog.find(q => q.sql.includes('INSERT'));

  assert.ok(selectRoles,  'debe consultar la tabla roles para obtener el role_id');
  assert.ok(selectStaff,  'debe buscar staff_member.staff_id por email del employee');
  assert.ok(insertStaff,  'debe insertar en company_staff');
  assert.ok(selectRoles.params.includes('root_admin'), 'debe buscar el roleType correcto');

  // staff_id en el INSERT debe ser el INT de staff_member, no un MongoDB ObjectId
  const staffIdInserted = insertStaff.params[2];
  assert.equal(typeof staffIdInserted, 'number', 'staff_id debe ser INT (staff_member.id)');
  assert.equal(staffIdInserted, 74);
});

test('createCompany: 201 pero NO sincroniza SQL cuando roleType está ausente', async () => {
  queryLog.length = 0;

  // sin roleType → el bloque SQL se omite por completo
  const req = baseReq(baseEmployee({ userId: 'user-mongo-id' }));
  const res = mockRes();

  await createCompany(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);

  const insertStaff = queryLog.find(q => q.sql.includes('INSERT'));
  assert.equal(insertStaff, undefined, 'NO debe insertar en company_staff si no hay roleType');
});

test('createCompany: busca el userId en AdminUser por email cuando userId no viene en el employee', async () => {
  queryLog.length = 0;

  // userId ausente → el controlador llama AdminUser.findOne({ email: emp.user })
  const req = baseReq(baseEmployee({ roleType: 'admin' }));
  const res = mockRes();

  await createCompany(req, res);

  assert.equal(res.statusCode, 201);

  // El INSERT debe haberse ejecutado usando el _id encontrado por email
  const insertStaff = queryLog.find(q => q.sql.includes('INSERT'));
  assert.ok(insertStaff, 'debe insertar en company_staff usando el userId encontrado por email');
});
