'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.SECRET_JWT_SEED = 'test-seed-for-registration';

// ─── Registro de llamadas SQL ─────────────────────────────────────────────────
const sqlLog = [];

// ─── Comportamiento configurable para los stubs ───────────────────────────────
// Los tests mutan estas propiedades en lugar de reemplazar require.cache,
// ya que el controller captura las referencias al módulo en el momento del import.
const sqlBehavior = {
  failCompanyInsert:  false,
  staffMemberNotFound: false,
};

const companyBehavior = {
  capturedDocs: null, // array cuando queremos capturar, null para no capturar
};

// ─── Stub: SQL connection ─────────────────────────────────────────────────────
const sqlConnPath = require.resolve('../mysql/database/config');
require.cache[sqlConnPath] = {
  id: sqlConnPath, filename: sqlConnPath, loaded: true,
  exports: () => ({
    execute: async (sql, params) => {
      sqlLog.push({ type: 'execute', sql, params });
      if (sql.includes('INSERT INTO staff_member'))  return [{ insertId: 99 }];
      if (sql.includes('INSERT INTO company_info')) {
        if (sqlBehavior.failCompanyInsert) throw new Error('Simulated DB error');
        return [{ insertId: 42 }];
      }
      if (sql.includes('FROM staff_member')) {
        if (sqlBehavior.staffMemberNotFound) return [[]];
        return [[{ staff_id: 99 }]];
      }
      return [[]];
    },
    query: async (sql, params) => {
      sqlLog.push({ type: 'query', sql, params });
      if (sql.includes('SELECT id FROM roles'))             return [[{ id: 'role-uuid' }]];
      if (sql.includes('INSERT IGNORE INTO company_staff')) return [{ affectedRows: 1 }];
      return [[]];
    },
  }),
};

// ─── Stub: bcrypt (nativo, API async) ───────────────────────────────────────────────────────────
const bcryptPath = require.resolve('bcrypt');
require.cache[bcryptPath] = {
  id: bcryptPath, filename: bcryptPath, loaded: true,
  exports: {
    genSalt: async () => 'salt',
    hash:    async (pw) => `hashed:${pw}`,
  },
};

// ─── Stub: generateJWT ───────────────────────────────────────────────────────
const jwtPath = require.resolve('../helpers/jwt');
require.cache[jwtPath] = {
  id: jwtPath, filename: jwtPath, loaded: true,
  exports: {
    generateJWT: async (uid, name, tokenVersion, sqlStaffId) =>
      `token::${uid}::${sqlStaffId}`,
  },
};

// ─── Stub: Redis ─────────────────────────────────────────────────────────────
// Con MFA_REQUIRED=false el alta abre sesión (helpers/staffSession.js). Sin
// esto el test conectaría con el Redis del .env.
const redisPath = require.resolve('../database/cacheMemoryConfig');
const redisKeys = {};
require.cache[redisPath] = {
  id: redisPath, filename: redisPath, loaded: true,
  exports: {
    clientRedis: async () => ({
      set: async (k, v) => { redisKeys[k] = v; return 'OK'; },
      get: async (k) => redisKeys[k] ?? null,
      del: async (k) => { delete redisKeys[k]; return 1; },
    }),
  },
};

// ─── Stub: Logger ─────────────────────────────────────────────────────────────
const loggerPath = require.resolve('../helpers/logger');
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { error: () => {}, info: () => {}, warn: () => {} },
};

// ─── Fake AdminUser ───────────────────────────────────────────────────────────
let adminUserFindOneResult  = null;
let adminUserFindByIdResult = null;

class FakeAdminUser {
  constructor(data) {
    Object.assign(this, data);
    this.id           = 'new-mongo-uid';
    this.tokenVersion = 1;
  }
  async save() { return this; }
}
FakeAdminUser.findOne  = async () => adminUserFindOneResult;
FakeAdminUser.findById = async () => adminUserFindByIdResult;

const adminUserPath = require.resolve('../models/AdminUser');
require.cache[adminUserPath] = {
  id: adminUserPath, filename: adminUserPath, loaded: true,
  exports: FakeAdminUser,
};

// ─── Fake Company ─────────────────────────────────────────────────────────────
let companyFindOneResult = null;

class FakeCompany {
  constructor(data) {
    Object.assign(this, data);
    this._id = 'fake-company-mongo-id';
  }
  async save() {
    if (companyBehavior.capturedDocs) companyBehavior.capturedDocs.push(this);
    return this;
  }
}
FakeCompany.findOne = async () => companyFindOneResult;

const companyModelPath = require.resolve('../models/Company');
require.cache[companyModelPath] = {
  id: companyModelPath, filename: companyModelPath, loaded: true,
  exports: FakeCompany,
};

// Importar el controller DESPUÉS de todos los stubs
const {
  registerNewUserAndCompany,
  registerExistingUserNewCompany,
} = require('../controller/registration');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload)  { this.body = payload;   return this; },
  };
}

function baseUserPayload(overrides = {}) {
  return {
    name:         'Ana',
    lastName:     'López',
    email:        'ana@test.com',
    password:     'secret123-long',
    phone:        '555-0001',
    imageProfile: '',
    ...overrides,
  };
}

function baseCompanyPayload(overrides = {}) {
  return {
    company_name:       'Test Corp',
    website:            'https://test.com',
    phone:              { main: '555-0000', alternative: '' },
    main_email:         'info@test.com',
    industry:           'Tech',
    address:            { street: '123 Main', city: 'NYC', state: 'NY', postal_code: '10001' },
    location:           ['Main Office'],
    company_logo:       '',
    stripe_customer_id: 'cus_test123',
    ...overrides,
  };
}

function resetState() {
  sqlLog.length            = 0;
  adminUserFindOneResult   = null;
  adminUserFindByIdResult  = null;
  companyFindOneResult     = null;
  sqlBehavior.failCompanyInsert   = false;
  sqlBehavior.staffMemberNotFound = false;
  companyBehavior.capturedDocs    = null;
}

// ══════════════════════════════════════════════════════════════════════════════
// registerNewUserAndCompany
// ══════════════════════════════════════════════════════════════════════════════

test('registerNewUserAndCompany: 400 si el email ya existe en MongoDB', async () => {
  resetState();
  adminUserFindOneResult = { email: 'ana@test.com' };

  const req = { body: { user: baseUserPayload(), company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.ok(res.body.msg.includes('ana@test.com'));
});

test('registerNewUserAndCompany: 400 si el nombre de empresa ya existe en MongoDB', async () => {
  resetState();
  companyFindOneResult = { company_name: 'Test Corp' };

  const req = { body: { user: baseUserPayload(), company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.ok(res.body.msg.includes('Test Corp'));
});

test('registerNewUserAndCompany: 400 si faltan campos requeridos del user', async () => {
  resetState();

  const req = { body: { user: { name: 'Ana', lastName: 'López', email: 'ana@test.com' }, company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('registerNewUserAndCompany: 400 con una contraseña de menos de 12 caracteres (IA-5)', async () => {
  resetState();

  const req = { body: { user: baseUserPayload({ password: 'secret123' }), company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.msg, /12/);
  assert.equal(sqlLog.length, 0, 'no toca MySQL');
});

test('registerNewUserAndCompany: 400 si faltan campos requeridos de company', async () => {
  resetState();

  const req = { body: { user: baseUserPayload(), company: { company_name: 'Test Corp' } } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('registerNewUserAndCompany: 201 — flujo exitoso — retorna enrolamiento de MFA (no sesión) + user + company', async () => {
  resetState();

  const req = { body: { user: baseUserPayload(), company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  // MFA obligatoria: la cuenta nueva no tiene MFA, así que no recibe sesión.
  assert.equal(res.body.token, undefined, 'no debe retornar token de sesión');
  assert.equal(res.body.mfaSetupRequired, true);
  assert.ok(res.body.mfaSetupToken, 'debe retornar el token de enrolamiento');
  assert.ok(res.body.user,    'debe retornar user');
  assert.ok(res.body.company, 'debe retornar company');
  assert.equal(res.body.user.email,         'ana@test.com');
  assert.equal(res.body.company.company_name, 'Test Corp');
});

test('registerNewUserAndCompany: flujo exitoso — inserta staff_member en MySQL', async () => {
  resetState();
  sqlBehavior.staffMemberNotFound = true;

  const req = { body: { user: baseUserPayload(), company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  const staffInsert = sqlLog.find(q => q.sql.includes('INSERT INTO staff_member'));
  assert.ok(staffInsert, 'debe insertar en staff_member');
  assert.equal(staffInsert.params[2], 'ana@test.com', 'debe insertar el email correcto');
});

// `staff_member.email` tiene UNIQUE desde 2026-08-18 (ver
// mysql/migrations/dedupe_staff_member_by_email.sql). Insertar igual devolvería
// 1062; antes del índice devolvía una fila duplicada más, que es lo que hacía
// ambigua la resolución de staff_id.
test('registerNewUserAndCompany: reutiliza el staff_member existente en vez de insertar otro', async () => {
  resetState();
  // El default del stub SQL es "el email ya está en staff_member" (staff_id 99).

  const req = { body: { user: baseUserPayload(), company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(
    sqlLog.find(q => q.sql.includes('INSERT INTO staff_member')),
    undefined,
    'no debe insertar cuando el email ya existe'
  );

  const lookup = sqlLog.find(q => q.sql.includes('FROM staff_member'));
  assert.ok(lookup, 'debe resolver el staff_id existente por email');
  assert.equal(lookup.params[0], 'ana@test.com');
});

test('registerNewUserAndCompany: flujo exitoso — inserta company_info en MySQL', async () => {
  resetState();

  const req = { body: { user: baseUserPayload(), company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  const companyInsert = sqlLog.find(q => q.sql.includes('INSERT INTO company_info'));
  assert.ok(companyInsert, 'debe insertar en company_info');
  assert.equal(companyInsert.params[0], 'Test Corp', 'debe insertar el nombre correcto');
});

test('registerNewUserAndCompany: flujo exitoso — sincroniza company_staff con sqlCompanyId INT', async () => {
  resetState();

  const req = { body: { user: baseUserPayload(), company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  const staffSync = sqlLog.find(q => q.sql.includes('INSERT IGNORE INTO company_staff'));
  assert.ok(staffSync, 'debe insertar en company_staff');

  // company_id debe ser el INT de company_info (42), NO el MongoDB ObjectId
  const companyIdInserted = staffSync.params[1];
  assert.equal(typeof companyIdInserted, 'number', 'company_id en company_staff debe ser INT');
  assert.equal(companyIdInserted, 42);
});

test('registerNewUserAndCompany: con MFA_REQUIRED=false, el token incluye sqlStaffId', async () => {
  resetState();
  process.env.MFA_REQUIRED = 'false';
  try {
    const req = { body: { user: baseUserPayload(), company: baseCompanyPayload() } };
    const res = mockRes();
    await registerNewUserAndCompany(req, res);

    // El stub retorna `token::uid::sqlStaffId`
    assert.ok(res.body.token.includes('99'), 'el token debe embeber el sqlStaffId del staff_member insertado');
  } finally {
    delete process.env.MFA_REQUIRED;
  }
});

test('registerNewUserAndCompany: NO inserta company_staff si company_info falla en SQL', async () => {
  resetState();
  sqlBehavior.failCompanyInsert = true;

  const req = { body: { user: baseUserPayload(), company: baseCompanyPayload() } };
  const res = mockRes();
  await registerNewUserAndCompany(req, res);

  // La creación MongoDB sigue — la respuesta es 201
  assert.equal(res.statusCode, 201, 'error SQL no debe romper el registro');
  const staffSync = sqlLog.find(q => q.sql.includes('INSERT IGNORE INTO company_staff'));
  assert.equal(staffSync, undefined, 'NO debe sincronizar company_staff si sqlCompanyId es null');
});

// ══════════════════════════════════════════════════════════════════════════════
// registerExistingUserNewCompany
// ══════════════════════════════════════════════════════════════════════════════

test('registerExistingUserNewCompany: 400 si user.userId está ausente', async () => {
  resetState();

  const req = { body: { user: {}, company: baseCompanyPayload() } };
  const res = mockRes();
  await registerExistingUserNewCompany(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('registerExistingUserNewCompany: 404 si el userId no existe en MongoDB', async () => {
  resetState();
  adminUserFindByIdResult = null;

  const req = { body: { user: { userId: 'nonexistent-id' }, company: baseCompanyPayload() } };
  const res = mockRes();
  await registerExistingUserNewCompany(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});

test('registerExistingUserNewCompany: 400 si el nombre de empresa ya existe', async () => {
  resetState();
  adminUserFindByIdResult = { id: 'existing-uid', name: 'Ana', lastName: 'López', email: 'ana@test.com', phone: '' };
  companyFindOneResult    = { company_name: 'Test Corp' };

  const req = { body: { user: { userId: 'existing-uid' }, company: baseCompanyPayload() } };
  const res = mockRes();
  await registerExistingUserNewCompany(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('registerExistingUserNewCompany: 201 — flujo exitoso — retorna user + company', async () => {
  resetState();
  adminUserFindByIdResult = {
    id: 'existing-uid', name: 'Ana', lastName: 'López',
    email: 'ana@test.com', phone: '555-0000', imageProfile: '', role: 0,
  };

  const req = { body: { user: { userId: 'existing-uid' }, company: baseCompanyPayload() } };
  const res = mockRes();
  await registerExistingUserNewCompany(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.user,    'debe retornar user');
  assert.ok(res.body.company, 'debe retornar company');
  assert.equal(res.body.user.email,           'ana@test.com');
  assert.equal(res.body.company.company_name, 'Test Corp');
});

test('registerExistingUserNewCompany: sincroniza company_staff con sqlCompanyId INT', async () => {
  resetState();
  adminUserFindByIdResult = {
    id: 'existing-uid', name: 'Ana', lastName: 'López',
    email: 'ana@test.com', phone: '', imageProfile: '', role: 0,
  };

  const req = { body: { user: { userId: 'existing-uid' }, company: baseCompanyPayload() } };
  const res = mockRes();
  await registerExistingUserNewCompany(req, res);

  const staffSync = sqlLog.find(q => q.sql.includes('INSERT IGNORE INTO company_staff'));
  assert.ok(staffSync, 'debe insertar en company_staff');

  const companyIdInserted = staffSync.params[1];
  assert.equal(typeof companyIdInserted, 'number', 'company_id debe ser INT de company_info');
  assert.equal(companyIdInserted, 42);
});

test('registerExistingUserNewCompany: crea staff_member si no existe en SQL', async () => {
  resetState();
  sqlBehavior.staffMemberNotFound = true;
  adminUserFindByIdResult = {
    id: 'existing-uid', name: 'Ana', lastName: 'López',
    email: 'nuevo@test.com', phone: '', imageProfile: '', role: 0,
  };

  const req = { body: { user: { userId: 'existing-uid' }, company: baseCompanyPayload() } };
  const res = mockRes();
  await registerExistingUserNewCompany(req, res);

  assert.equal(res.statusCode, 201);
  const staffInsert = sqlLog.find(q => q.sql.includes('INSERT INTO staff_member'));
  assert.ok(staffInsert, 'debe insertar staff_member cuando no existe en SQL');
  assert.equal(staffInsert.params[2], 'nuevo@test.com');
});

test('registerExistingUserNewCompany: employees[0] tiene roleType root_admin y userId correcto', async () => {
  resetState();
  companyBehavior.capturedDocs = [];
  adminUserFindByIdResult = {
    id: 'existing-uid', name: 'Ana', lastName: 'López',
    email: 'ana@test.com', phone: '', imageProfile: '', role: 0,
  };

  const req = { body: { user: { userId: 'existing-uid' }, company: baseCompanyPayload() } };
  const res = mockRes();
  await registerExistingUserNewCompany(req, res);

  assert.equal(companyBehavior.capturedDocs.length, 1, 'debe guardar exactamente un documento de Company');
  const emp = companyBehavior.capturedDocs[0].employees?.[0];
  assert.ok(emp, 'debe tener employees[0]');
  assert.equal(emp.roleType, 'root_admin',    'roleType debe ser root_admin');
  assert.equal(emp.userId,   'existing-uid',  'userId debe ser el MongoDB ID del usuario');
});
