'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// staff.js captura `const connection = getConnection()` al nivel de módulo,
// por lo que el stub debe estar en cache ANTES del primer require del controlador.

// Cola mutable: cada test la recarga con pushResults(...) antes de ejecutar.
const queryQueue = [];

function pushResults(...results) {
  queryQueue.length = 0;
  queryQueue.push(...results);
}

const connPath = path.resolve(__dirname, '../mysql/database/config.js');
require.cache[connPath] = {
  id: connPath, filename: connPath, loaded: true,
  exports: () => ({
    query:   async () => queryQueue.shift() ?? [[]],
    execute: async () => queryQueue.shift() ?? [[]],
  }),
};

// Ahora sí se importa — capturará nuestro stub como `connection`
const {
  getStaffPermissions,
  consultingStaffMemberInformation,
  addCompanyStaff,
  updateCompanyStaffRole,
  updateCompanyStaff,
  getStaffCompanies,
} = require('../mysql/controllers/staff');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload)  { this.body = payload;   return this; },
    setHeader(key, val) { this.headers[key] = val; return this; },
  };
}

// ─── consultingStaffMemberInformation ─────────────────────────────────────────

test('consulting-member: 400 cuando body no tiene ninguna key de la whitelist', async () => {
  // Con sesión: sin ella solo se acepta `email` (FedRAMP A2, fedrampA2Batch2.test.js).
  const req = { uid: 'u1', body: { nombre: 'Juan', cargo: 'admin', empresa: 'Acme' } };
  const res = mockRes();

  await consultingStaffMemberInformation(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /No valid filter fields/);
});

test('consulting-member: 400 con body vacío', async () => {
  const req = { body: {} };
  const res = mockRes();

  await consultingStaffMemberInformation(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('consulting-member: 200 usando solo las keys válidas — ignora keys fuera de whitelist', async () => {
  pushResults([[
    { id: 1, first_name: 'Ana', last_name: 'López', email: 'ana@test.com', phone_number: '555' },
  ]]);
  // body mezcla keys válidas e inválidas
  const req = { body: { email: 'ana@test.com', cargo: 'ignorado', nivel: 'ignorado' } };
  const res = mockRes();

  await consultingStaffMemberInformation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.member));
});

// ─── getStaffPermissions ──────────────────────────────────────────────────────

test('getStaffPermissions: 404 cuando no existe registro activo en company_staff', async () => {
  pushResults([[]]); // sin filas
  const req = { body: { company_id: 'comp-1', staff_id: 'staff-1' } };
  const res = mockRes();

  await getStaffPermissions(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /No active staff record/);
});

test('getStaffPermissions: 200 devuelve roleType, role_level y permissions como flat strings "resource:action"', async () => {
  pushResults([[
    { role_type: 'event_manager', role_level: 3, resource: 'event',       action: 'create' },
    { role_type: 'event_manager', role_level: 3, resource: 'event',       action: 'read' },
    { role_type: 'event_manager', role_level: 3, resource: 'transaction', action: 'create' },
    { role_type: 'event_manager', role_level: 3, resource: 'staff',       action: 'update_contact' },
  ]]);
  const req = { body: { company_id: 'comp-1', staff_id: 'staff-1' } };
  const res = mockRes();

  await getStaffPermissions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.roleType, 'event_manager');
  assert.ok(!('role_type' in res.body), 'no debe exponer role_type en snake_case');
  assert.equal(res.body.role_level, 3);
  assert.equal(res.body.permissions.length, 4);
  assert.equal(res.body.permissions[0], 'event:create');           // flat string
  assert.equal(res.body.permissions[3], 'staff:update_contact');   // flat string
});

test('getStaffPermissions: 200 incluye locations con location_id (INT), nombre y flags', async () => {
  pushResults(
    [[
      { role_type: 'inventory_manager', role_level: 4, resource: 'inventory', action: 'create' },
      { role_type: 'inventory_manager', role_level: 4, resource: 'inventory', action: 'read' },
    ]],
    [[
      { location_id: 3, location_name: 'Warehouse A', can_create: 1, can_update: 1, can_delete: 0 },
      { location_id: 7, location_name: 'Store Front',  can_create: 0, can_update: 1, can_delete: 0 },
    ]],
  );
  const req = { body: { company_id: 'comp-1', staff_id: 'staff-1' } };
  const res = mockRes();

  await getStaffPermissions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.locations), 'locations debe ser un array');
  assert.equal(res.body.locations.length, 2);
  assert.deepEqual(res.body.locations[0], {
    location_id: 3, location: 'Warehouse A', can_create: true, can_update: true, can_delete: false,
  });
  assert.deepEqual(res.body.locations[1], {
    location_id: 7, location: 'Store Front', can_create: false, can_update: true, can_delete: false,
  });
});

test('getStaffPermissions: 200 devuelve locations vacío cuando no hay asignaciones', async () => {
  pushResults(
    [[{ role_type: 'assistant', role_level: 5, resource: 'staff', action: 'update_contact' }]],
    [[]], // sin filas en staff_location_access
  );
  const req = { body: { company_id: 'comp-1', staff_id: 'staff-2' } };
  const res = mockRes();

  await getStaffPermissions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.locations, []);
});

// ─── addCompanyStaff ──────────────────────────────────────────────────────────

// ─── addCompanyStaff con company_name ─────────────────────────────────────────

test('addCompanyStaff: 201 persiste company_name cuando se incluye en el body', async () => {
  pushResults(
    [[{ id: 'role-uuid-999' }]], // SELECT id FROM roles
    [{ affectedRows: 1 }],       // INSERT INTO company_staff
  );
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'admin', company_name: 'Acme Corp' } };
  const res = mockRes();

  await addCompanyStaff(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
});

test('addCompanyStaff: 400 con role_type fuera de los 6 valores válidos', async () => {
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'super_god' } };
  const res = mockRes();

  await addCompanyStaff(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /Invalid role_type/);
});

test('addCompanyStaff: 201 inserta en company_staff con role_type válido', async () => {
  pushResults(
    [[{ id: 'role-uuid-123' }]], // SELECT id FROM roles
    [[]],                        // SELECT is_active (tope del plan): no estaba
    [{ affectedRows: 1 }],       // INSERT IGNORE INTO company_staff
  );
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'sale_manager' } };
  const res = mockRes();

  await addCompanyStaff(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.inserted, 1);
});

// ─── updateCompanyStaffRole ───────────────────────────────────────────────────

test('updateCompanyStaffRole: 400 con role_type inválido', async () => {
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'unknown_role' } };
  const res = mockRes();

  await updateCompanyStaffRole(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /Invalid role_type/);
});

test('updateCompanyStaffRole: 404 cuando el staff no pertenece a la empresa', async () => {
  pushResults(
    [[{ id: 'role-1' }]],  // SELECT id FROM roles → rol encontrado
    [{ affectedRows: 0 }], // UPDATE → sin filas afectadas
  );
  const req = { body: { company_id: 'c1', staff_id: 's999', role_type: 'admin' } };
  const res = mockRes();

  await updateCompanyStaffRole(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /Staff member not found/);
});

test('updateCompanyStaffRole: 200 cuando el rol se actualiza correctamente', async () => {
  pushResults(
    [[{ id: 'role-2' }]],  // SELECT id FROM roles
    [{ affectedRows: 1 }], // UPDATE → fila actualizada
  );
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'inventory_manager' } };
  const res = mockRes();

  await updateCompanyStaffRole(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.updated, 1);
});

// ─── getStaffCompanies ────────────────────────────────────────────────────────

test('getStaffCompanies: 401 cuando falta sqlStaffId en request (token no enriquecido)', async () => {
  const req = { uid: '661d7f57b5dd5c170d866933', sqlStaffId: undefined };
  const res = mockRes();

  await getStaffCompanies(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test('getStaffCompanies: 200 devuelve lista de empresas con company_name, roleType, role_level y locations', async () => {
  pushResults(
    // 1ª query: company_staff JOIN roles — filtra por sqlStaffId (INT, e.g. 74)
    [[
      { company_id: 'co-aaa', company_name: 'Acme Corp', role_type: 'admin',             role_level: 1, company_staff_id: 'cs-1' },
      { company_id: 'co-bbb', company_name: 'Beta LLC',  role_type: 'inventory_manager', role_level: 4, company_staff_id: 'cs-2' },
    ]],
    // 2ª query: staff_location_access JOIN locations para cs-1
    [[
      { location_id: 5, location_name: 'Main Warehouse', can_create: 1, can_update: 1, can_delete: 0 },
    ]],
    // 3ª query: staff_location_access para cs-2
    [[]],
  );
  // sqlStaffId viene de validateJWT (resuelto desde JWT enriquecido), no de query param
  const req = { uid: '661d7f57b5dd5c170d866933', sqlStaffId: 74 };
  const res = mockRes();

  await getStaffCompanies(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.companies.length, 2);

  const first = res.body.companies[0];
  assert.equal(first.company_id, 'co-aaa');
  assert.equal(first.company_name, 'Acme Corp');
  assert.equal(first.roleType, 'admin');
  assert.equal(first.role_level, 1);
  assert.equal(first.locations.length, 1);
  assert.deepEqual(first.locations[0], {
    location_id: 5, location: 'Main Warehouse', can_create: true, can_update: true, can_delete: false,
  });

  const second = res.body.companies[1];
  assert.equal(second.company_id, 'co-bbb');
  assert.equal(second.company_name, 'Beta LLC');
  assert.equal(second.roleType, 'inventory_manager');
  assert.equal(second.role_level, 4);
  assert.deepEqual(second.locations, []);
});

test('getStaffCompanies: 200 con lista vacía cuando sqlStaffId no pertenece a ninguna empresa', async () => {
  pushResults([[]]); // sin filas en company_staff
  const req = { uid: '661d7f57b5dd5c170d866933', sqlStaffId: 999 };
  const res = mockRes();

  await getStaffCompanies(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.companies, []);
});

// ─── updateCompanyStaff ───────────────────────────────────────────────────────

test('updateCompanyStaff: 400 cuando falta company_id o staff_id', async () => {
  const req = { body: { is_active: 0 } };
  const res = mockRes();

  await updateCompanyStaff(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /company_id.*staff_id|required/i);
});

test('updateCompanyStaff: 400 cuando no se envía ningún campo modificable', async () => {
  const req = { body: { company_id: 'c1', staff_id: 's1' } };
  const res = mockRes();

  await updateCompanyStaff(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /no field|is_active.*role_type/i);
});

test('updateCompanyStaff: 400 cuando is_active no es 0 ni 1', async () => {
  const req = { body: { company_id: 'c1', staff_id: 's1', is_active: 2 } };
  const res = mockRes();

  await updateCompanyStaff(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /is_active/i);
});

test('updateCompanyStaff: 400 cuando role_type no está en la lista válida', async () => {
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'super_god' } };
  const res = mockRes();

  await updateCompanyStaff(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /Invalid role_type/);
});

test('updateCompanyStaff: 400 cuando role_type no existe en la tabla roles', async () => {
  pushResults([[]]); // roles lookup devuelve vacío
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'admin' } };
  const res = mockRes();

  await updateCompanyStaff(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /Role not found/);
});

test('updateCompanyStaff: 404 cuando el par company_id+staff_id no existe en company_staff', async () => {
  pushResults([{ affectedRows: 0 }]); // UPDATE sin filas afectadas
  const req = { body: { company_id: 'c1', staff_id: 's999', is_active: 0 } };
  const res = mockRes();

  await updateCompanyStaff(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
  assert.match(res.body.msg, /Staff member not found/);
});

test('updateCompanyStaff: 200 actualiza solo is_active', async () => {
  pushResults([{ affectedRows: 1 }]); // UPDATE
  const req = { body: { company_id: 'c1', staff_id: 's1', is_active: 0 } };
  const res = mockRes();

  await updateCompanyStaff(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.updated, 1);
});

test('updateCompanyStaff: 200 actualiza solo role_type', async () => {
  pushResults(
    [[{ id: 3 }]],       // SELECT id FROM roles
    [{ affectedRows: 1 }], // UPDATE
  );
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'assistant' } };
  const res = mockRes();

  await updateCompanyStaff(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.updated, 1);
});

test('updateCompanyStaff: 200 actualiza role_type e is_active simultáneamente', async () => {
  pushResults(
    [[{ id: 2 }]],       // SELECT id FROM roles
    [[{ is_active: 0 }]], // SELECT is_active (tope del plan): reactivación
    [{ affectedRows: 1 }], // UPDATE
  );
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'sale_manager', is_active: 1 } };
  const res = mockRes();

  await updateCompanyStaff(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.updated, 1);
});
