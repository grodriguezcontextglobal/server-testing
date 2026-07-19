'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// ════════════════════════════════════════════════════════════════════════════════
// REGRESIÓN — módulo compartido mysql/constants/roles.js
// ════════════════════════════════════════════════════════════════════════════════

const { VALID_ROLE_TYPES: ROLES_SET, VALID_ROLE_TYPES_LIST: ROLES_LIST } =
  require('../mysql/constants/roles');

test('roles/constants: exporta Set y Array con los 10 role_types canónicos', () => {
  assert.equal(ROLES_SET.size, 10, 'Set debe tener exactamente 10 roles');
  assert.equal(ROLES_LIST.length, 10, 'Array debe tener exactamente 10 roles');
  assert.ok(ROLES_SET.has('inventory_location_manager'),   'debe incluir inventory_location_manager');
  assert.ok(ROLES_SET.has('inventory_location_assistant'), 'debe incluir inventory_location_assistant');
  assert.ok(ROLES_SET.has('category_manager'),             'debe incluir category_manager');
  assert.ok(ROLES_SET.has('category_assistant'),           'debe incluir category_assistant');
  assert.ok(ROLES_SET.has('inventory_manager'),            'inventory_manager no debe eliminarse');
  // Set y Array deben ser consistentes
  assert.deepEqual(new Set(ROLES_LIST), ROLES_SET, 'Set y Array deben contener los mismos valores');
});

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
//
// Perf fix (fase 2 del audit SQL): rol + locations se resuelven en UNA sola query
// (LEFT JOIN + GROUP_CONCAT) en vez de 2 queries secuenciales. Los roles full-access
// siguen ignorando location_ids (bypass), pero ya no hay una segunda ida a la DB
// para ningún caso.
// ════════════════════════════════════════════════════════════════════════════════

test('getStaffCompanyAccess: inventory_location_manager (level 6) resuelve rol+locations en 1 query', async () => {
  const calls = [];
  const { getStaffCompanyAccess } = loadStaffAccess(async (sql) => {
    calls.push(sql.trim().slice(0, 20));
    return [[{ company_staff_id: 'cs-10', role_type: 'inventory_location_manager', role_level: 6, location_ids: '3,7' }]];
  });

  const result = await getStaffCompanyAccess(42, 5);

  assert.equal(calls.length, 1, 'debe resolver rol y locations en una sola query');
  assert.equal(result.role_type, 'inventory_location_manager');
  assert.equal(result.role_level, 6);
  assert.deepEqual(result.locations, [3, 7]);
});

test('getStaffCompanyAccess: inventory_location_assistant (level 7) resuelve rol+locations en 1 query', async () => {
  const calls = [];
  const { getStaffCompanyAccess } = loadStaffAccess(async (sql) => {
    calls.push(sql.trim().slice(0, 20));
    return [[{ company_staff_id: 'cs-11', role_type: 'inventory_location_assistant', role_level: 7, location_ids: '5' }]];
  });

  const result = await getStaffCompanyAccess(99, 5);

  assert.equal(calls.length, 1, 'debe resolver rol y locations en una sola query');
  assert.equal(result.role_type, 'inventory_location_assistant');
  assert.equal(result.role_level, 7);
  assert.deepEqual(result.locations, [5]);
});

test('getStaffCompanyAccess: location-scoped sin locations asignadas → array vacío (GROUP_CONCAT NULL)', async () => {
  const { getStaffCompanyAccess } = loadStaffAccess(async () => {
    return [[{ company_staff_id: 'cs-12', role_type: 'assistant', role_level: 5, location_ids: null }]];
  });

  const result = await getStaffCompanyAccess(50, 5);

  assert.deepEqual(result.locations, []);
});

test('getStaffCompanyAccess: inventory_manager (level 4) sigue siendo full-access — 1 query, ignora location_ids', async () => {
  const calls = [];
  const { getStaffCompanyAccess } = loadStaffAccess(async (sql) => {
    calls.push(sql.trim().slice(0, 20));
    return [[{ company_staff_id: 'cs-4', role_type: 'inventory_manager', role_level: 4, location_ids: '99' }]];
  });

  const result = await getStaffCompanyAccess(74, 5);

  assert.equal(calls.length, 1, 'inventory_manager hace solo 1 query');
  assert.equal(result.role_type, 'inventory_manager');
  assert.deepEqual(result.locations, [], 'full-access debe ignorar location_ids aunque la query los traiga');
});

// ════════════════════════════════════════════════════════════════════════════════
// BLOQUE D — Roles category-scoped (nivel 8/9) y el flag `scoped`
// staffAccess resuelve rol + locations + category_ids en UNA query (LEFT JOIN doble
// con GROUP_CONCAT DISTINCT). item_inv se filtra por category_name (no tiene
// category_id), así que los ids asignados se resuelven a nombres en una SEGUNDA
// query — pero SÓLO cuando el rol tiene categorías asignadas.
// ════════════════════════════════════════════════════════════════════════════════

const { SCOPED_ROLES } = require('../mysql/helpers/staffAccess');

test('staffAccess: SCOPED_ROLES contiene los 4 roles location/category-scoped (6,7,8,9)', () => {
  assert.ok(SCOPED_ROLES.has(6) && SCOPED_ROLES.has(7), 'location-scoped');
  assert.ok(SCOPED_ROLES.has(8) && SCOPED_ROLES.has(9), 'category-scoped');
  assert.ok(!SCOPED_ROLES.has(3) && !SCOPED_ROLES.has(5),
    'sale/event_manager y assistant NO son scoped (verían su inventario habitual)');
  assert.ok(!SCOPED_ROLES.has(0) && !SCOPED_ROLES.has(4), 'full-access no es scoped');
});

test('getStaffCompanyAccess: category_manager (level 8) resuelve category_ids y sus nombres', async () => {
  const calls = [];
  const { getStaffCompanyAccess } = loadStaffAccess(async (sql) => {
    calls.push(sql);
    if (/company_item_categories/.test(sql)) {
      return [[{ category_name: 'Audio' }, { category_name: 'Video' }]];
    }
    return [[{ company_staff_id: 'cs-8', role_type: 'category_manager', role_level: 8, location_ids: null, category_ids: '11,12' }]];
  });

  const result = await getStaffCompanyAccess(60, 5);

  assert.equal(calls.length, 2, 'una query principal + una para resolver nombres de categoría');
  assert.equal(result.role_type, 'category_manager');
  assert.equal(result.role_level, 8);
  assert.equal(result.scoped, true, 'category_manager es scoped');
  assert.deepEqual(result.categories, [11, 12]);
  assert.deepEqual(result.categoryNames.slice().sort(), ['Audio', 'Video']);
  assert.deepEqual(result.locations, [], 'rol de categoría no tiene locations');
});

test('getStaffCompanyAccess: category_assistant (level 9) es scoped e igual resuelve nombres', async () => {
  const { getStaffCompanyAccess } = loadStaffAccess(async (sql) => {
    if (/company_item_categories/.test(sql)) return [[{ category_name: 'Cables' }]];
    return [[{ company_staff_id: 'cs-9', role_type: 'category_assistant', role_level: 9, location_ids: null, category_ids: '20' }]];
  });

  const result = await getStaffCompanyAccess(61, 5);

  assert.equal(result.role_level, 9);
  assert.equal(result.scoped, true);
  assert.deepEqual(result.categories, [20]);
  assert.deepEqual(result.categoryNames, ['Cables']);
});

test('getStaffCompanyAccess: category-scoped sin asignaciones → 1 query, arrays vacíos, scoped=true (fail-closed)', async () => {
  const calls = [];
  const { getStaffCompanyAccess } = loadStaffAccess(async (sql) => {
    calls.push(sql);
    return [[{ company_staff_id: 'cs-8b', role_type: 'category_manager', role_level: 8, location_ids: null, category_ids: null }]];
  });

  const result = await getStaffCompanyAccess(62, 5);

  assert.equal(calls.length, 1, 'sin categorías asignadas NO dispara la segunda query');
  assert.equal(result.scoped, true, 'sigue siendo scoped aunque no tenga asignaciones');
  assert.deepEqual(result.categories, []);
  assert.deepEqual(result.categoryNames, []);
});

test('getStaffCompanyAccess: el flag `scoped` distingue full-access de location-scoped', async () => {
  const { getStaffCompanyAccess: getFull } = loadStaffAccess(async () =>
    [[{ company_staff_id: 'cs-1', role_type: 'admin', role_level: 1, location_ids: null, category_ids: null }]]);
  const full = await getFull(1, 5);
  assert.equal(full.scoped, false, 'admin (full-access) scoped=false');

  const { getStaffCompanyAccess: getLoc } = loadStaffAccess(async () =>
    [[{ company_staff_id: 'cs-6', role_type: 'inventory_location_manager', role_level: 6, location_ids: '3', category_ids: null }]]);
  const loc = await getLoc(6, 5);
  assert.equal(loc.scoped, true, 'inventory_location_manager scoped=true');
  assert.deepEqual(loc.categories, [], 'rol de locación no trae categorías');
});

// ════════════════════════════════════════════════════════════════════════════════
// BLOQUE E — canWriteInScope: flags can_create/can_update/can_delete por asignación
// ════════════════════════════════════════════════════════════════════════════════

const locAccess = (locations, cs = 'cs-6') => ({ company_staff_id: cs, role_level: 6, scoped: true, locations, categoryNames: [] });
const catAccess = (categoryNames, cs = 'cs-8') => ({ company_staff_id: cs, role_level: 8, scoped: true, locations: [], categoryNames });

test('canWriteInScope: rol full-access/no-scoped → siempre true, sin consultar DB', async () => {
  let called = false;
  const { canWriteInScope } = loadStaffAccess(async () => { called = true; return [[]]; });
  const r = await canWriteInScope({ scoped: false, role_level: 1 }, 'delete', { locationId: 3 });
  assert.equal(r, true);
  assert.equal(called, false, 'no debe tocar la DB para full-access');
});

test('canWriteInScope: acción inválida → false', async () => {
  const { canWriteInScope } = loadStaffAccess(async () => [[{ flag: 1 }]]);
  assert.equal(await canWriteInScope(locAccess([3]), 'frobnicate', { locationId: 3 }), false);
});

test('canWriteInScope: locación fuera del scope → false sin consultar el flag', async () => {
  let called = false;
  const { canWriteInScope } = loadStaffAccess(async () => { called = true; return [[{ flag: 1 }]]; });
  const r = await canWriteInScope(locAccess([3, 7]), 'update', { locationId: 99 });
  assert.equal(r, false);
  assert.equal(called, false, 'no consulta el flag si la locación no está en el scope');
});

test('canWriteInScope: locación en scope + flag can_update=1 → true', async () => {
  const { canWriteInScope } = loadStaffAccess(async (sql) => {
    assert.match(sql, /can_update/);
    assert.match(sql, /staff_location_access/);
    return [[{ flag: 1 }]];
  });
  assert.equal(await canWriteInScope(locAccess([3]), 'update', { locationId: 3 }), true);
});

test('canWriteInScope: locación en scope pero flag can_delete=0 → false', async () => {
  const { canWriteInScope } = loadStaffAccess(async () => [[{ flag: 0 }]]);
  assert.equal(await canWriteInScope(locAccess([3]), 'delete', { locationId: 3 }), false);
});

test('canWriteInScope: categoría en scope + can_create=1 → true (join por category_name)', async () => {
  const { canWriteInScope } = loadStaffAccess(async (sql) => {
    assert.match(sql, /can_create/);
    assert.match(sql, /staff_category_access/);
    assert.match(sql, /company_item_categories/);
    return [[{ flag: 1 }]];
  });
  assert.equal(await canWriteInScope(catAccess(['Audio']), 'create', { categoryName: 'Audio' }), true);
});

test('canWriteInScope: categoría fuera del scope → false', async () => {
  const { canWriteInScope } = loadStaffAccess(async () => [[{ flag: 1 }]]);
  assert.equal(await canWriteInScope(catAccess(['Audio']), 'update', { categoryName: 'Video' }), false);
});

test('canWriteInScope: categoría en scope pero flag ausente → false', async () => {
  const { canWriteInScope } = loadStaffAccess(async () => [[]]); // no row
  assert.equal(await canWriteInScope(catAccess(['Audio']), 'delete', { categoryName: 'Audio' }), false);
});
