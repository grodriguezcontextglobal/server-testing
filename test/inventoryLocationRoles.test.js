'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// ─── Stub de DB para staff controller (captura a nivel de módulo) ─────────────
// staff.js llama getConnection() al cargar el módulo, por lo que el stub debe
// estar en cache ANTES del primer require del controlador.

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

const { addCompanyStaff, updateCompanyStaffRole, getStaffPermissions } =
  require('../mysql/controllers/staff');

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload)  { this.body = payload;   return this; },
  };
}

// ─── Loader para staffAccess (llama getConnection() dentro de la función) ─────
// Se puede recargar por test porque staffAccess no captura a nivel de módulo.

function loadStaffAccess(executeImpl) {
  const saPath = path.resolve(__dirname, '../mysql/helpers/staffAccess.js');
  delete require.cache[connPath];
  delete require.cache[saPath];
  require.cache[connPath] = {
    id: connPath, filename: connPath, loaded: true,
    exports: () => ({ execute: executeImpl }),
  };
  return require('../mysql/helpers/staffAccess');
}

// ════════════════════════════════════════════════════════════════════════════════
// BLOQUE A — Validación de role_type en controladores
// Estos tests deben fallar (RED) hasta que VALID_ROLES incluya los nuevos tipos.
// ════════════════════════════════════════════════════════════════════════════════

test('addCompanyStaff: 201 con role_type inventory_location_manager', async () => {
  pushResults(
    [[{ id: 'role-uuid-6' }]], // SELECT id FROM roles
    [{ affectedRows: 1 }],     // INSERT INTO company_staff
  );
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'inventory_location_manager' } };
  const res = mockRes();

  await addCompanyStaff(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
});

test('addCompanyStaff: 201 con role_type inventory_location_assistant', async () => {
  pushResults(
    [[{ id: 'role-uuid-7' }]],
    [{ affectedRows: 1 }],
  );
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'inventory_location_assistant' } };
  const res = mockRes();

  await addCompanyStaff(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
});

test('updateCompanyStaffRole: 200 con role_type inventory_location_manager', async () => {
  pushResults(
    [[{ id: 'role-uuid-6' }]],
    [{ affectedRows: 1 }],
  );
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'inventory_location_manager' } };
  const res = mockRes();

  await updateCompanyStaffRole(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('updateCompanyStaffRole: 200 con role_type inventory_location_assistant', async () => {
  pushResults(
    [[{ id: 'role-uuid-7' }]],
    [{ affectedRows: 1 }],
  );
  const req = { body: { company_id: 'c1', staff_id: 's1', role_type: 'inventory_location_assistant' } };
  const res = mockRes();

  await updateCompanyStaffRole(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

// ════════════════════════════════════════════════════════════════════════════════
// BLOQUE B — Permisos asignados por SQL (contrato del seed)
// Validan que la respuesta de getStaffPermissions refleje los permisos correctos
// para cada nuevo rol. Los mocks simulan lo que devolvería la DB tras aplicar
// seed_roles_permissions.sql con los nuevos INSERTs.
// ════════════════════════════════════════════════════════════════════════════════

test('getStaffPermissions: inventory_location_manager tiene inventory(CRUD) + location(CRUD)', async () => {
  pushResults([[
    { role_type: 'inventory_location_manager', role_level: 6, resource: 'inventory', action: 'create' },
    { role_type: 'inventory_location_manager', role_level: 6, resource: 'inventory', action: 'read'   },
    { role_type: 'inventory_location_manager', role_level: 6, resource: 'inventory', action: 'update' },
    { role_type: 'inventory_location_manager', role_level: 6, resource: 'inventory', action: 'delete' },
    { role_type: 'inventory_location_manager', role_level: 6, resource: 'location',  action: 'create' },
    { role_type: 'inventory_location_manager', role_level: 6, resource: 'location',  action: 'read'   },
    { role_type: 'inventory_location_manager', role_level: 6, resource: 'location',  action: 'update' },
    { role_type: 'inventory_location_manager', role_level: 6, resource: 'location',  action: 'delete' },
  ]]);
  const req = { body: { company_id: 'c1', staff_id: 's1' } };
  const res = mockRes();

  await getStaffPermissions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.roleType, 'inventory_location_manager');
  assert.equal(res.body.role_level, 6);

  const perms = res.body.permissions;
  assert.equal(perms.length, 8);
  assert.ok(perms.includes('inventory:create'));
  assert.ok(perms.includes('inventory:read'));
  assert.ok(perms.includes('inventory:update'));
  assert.ok(perms.includes('inventory:delete'));
  assert.ok(perms.includes('location:create'));
  assert.ok(perms.includes('location:read'));
  assert.ok(perms.includes('location:update'));
  assert.ok(perms.includes('location:delete'));
});

test('getStaffPermissions: inventory_location_assistant tiene solo inventory(RU) + location(RU)', async () => {
  pushResults([[
    { role_type: 'inventory_location_assistant', role_level: 7, resource: 'inventory', action: 'read'   },
    { role_type: 'inventory_location_assistant', role_level: 7, resource: 'inventory', action: 'update' },
    { role_type: 'inventory_location_assistant', role_level: 7, resource: 'location',  action: 'read'   },
    { role_type: 'inventory_location_assistant', role_level: 7, resource: 'location',  action: 'update' },
  ]]);
  const req = { body: { company_id: 'c1', staff_id: 's1' } };
  const res = mockRes();

  await getStaffPermissions(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.roleType, 'inventory_location_assistant');
  assert.equal(res.body.role_level, 7);

  const perms = res.body.permissions;
  assert.equal(perms.length, 4);
  assert.ok(perms.includes('inventory:read'));
  assert.ok(perms.includes('inventory:update'));
  assert.ok(perms.includes('location:read'));
  assert.ok(perms.includes('location:update'));
  // no debe tener create ni delete
  assert.ok(!perms.includes('inventory:create'), 'no debe tener inventory:create');
  assert.ok(!perms.includes('inventory:delete'), 'no debe tener inventory:delete');
  assert.ok(!perms.includes('location:create'),  'no debe tener location:create');
  assert.ok(!perms.includes('location:delete'),  'no debe tener location:delete');
});

// ════════════════════════════════════════════════════════════════════════════════
// BLOQUE C — Scoping en staffAccess: los roles nuevos son location-scoped
// staffAccess llama getConnection() dentro de la función → se puede recargar.
// inventory_manager (level 4) sigue siendo full-access como regresión de control.
// ════════════════════════════════════════════════════════════════════════════════

test('getStaffCompanyAccess: inventory_location_manager (level 6) ejecuta 2 queries — es location-scoped', async () => {
  const calls = [];
  const { getStaffCompanyAccess } = loadStaffAccess(async (sql) => {
    calls.push(sql.trim().slice(0, 20));
    if (calls.length === 1) {
      return [[{ company_staff_id: 'cs-10', role_type: 'inventory_location_manager', role_level: 6 }]];
    }
    return [[{ location_id: 3 }, { location_id: 7 }]];
  });

  const result = await getStaffCompanyAccess(42, 5);

  assert.equal(calls.length, 2, 'debe hacer 2 queries: rol y luego locations');
  assert.equal(result.role_type, 'inventory_location_manager');
  assert.equal(result.role_level, 6);
  assert.deepEqual(result.locations, [3, 7]);
});

test('getStaffCompanyAccess: inventory_location_assistant (level 7) ejecuta 2 queries — es location-scoped', async () => {
  const calls = [];
  const { getStaffCompanyAccess } = loadStaffAccess(async (sql) => {
    calls.push(sql.trim().slice(0, 20));
    if (calls.length === 1) {
      return [[{ company_staff_id: 'cs-11', role_type: 'inventory_location_assistant', role_level: 7 }]];
    }
    return [[{ location_id: 5 }]];
  });

  const result = await getStaffCompanyAccess(99, 5);

  assert.equal(calls.length, 2, 'debe hacer 2 queries: rol y luego locations');
  assert.equal(result.role_type, 'inventory_location_assistant');
  assert.equal(result.role_level, 7);
  assert.deepEqual(result.locations, [5]);
});

test('getStaffCompanyAccess: inventory_manager (level 4) sigue siendo full-access — solo 1 query (regresión)', async () => {
  const calls = [];
  const { getStaffCompanyAccess } = loadStaffAccess(async (sql) => {
    calls.push(sql.trim().slice(0, 20));
    return [[{ company_staff_id: 'cs-4', role_type: 'inventory_manager', role_level: 4 }]];
  });

  const result = await getStaffCompanyAccess(74, 5);

  assert.equal(calls.length, 1, 'inventory_manager hace solo 1 query — bypasea locations');
  assert.equal(result.role_type, 'inventory_manager');
  assert.deepEqual(result.locations, []);
});
