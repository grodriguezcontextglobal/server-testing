'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// setCompanyStaffScope uses a pinned pool connection + a transaction
// (pool.getConnection() → conn.beginTransaction/commit/rollback/release), so the
// config stub exposes both the pool-level query/execute AND getConnection(). All
// of setCompanyStaffScope's queries run on the pinned `conn`, whose query() pulls
// from a FIFO result queue and records the (sql, params) for assertions.

const resultQueue = [];
const recorded = [];
function pushResults(...results) { resultQueue.length = 0; resultQueue.push(...results); recorded.length = 0; }
const shift = () => (resultQueue.length ? resultQueue.shift() : [[]]);

const conn = {
  query: async (sql, params) => { recorded.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return shift(); },
  beginTransaction: async () => { recorded.push({ sql: 'BEGIN' }); },
  commit: async () => { recorded.push({ sql: 'COMMIT' }); },
  rollback: async () => { recorded.push({ sql: 'ROLLBACK' }); },
  release: () => { recorded.push({ sql: 'RELEASE' }); },
};
const pool = {
  query: async () => shift(),
  execute: async () => shift(),
  getConnection: async () => conn,
};

const connPath = path.resolve(__dirname, '../mysql/database/config.js');
require.cache[connPath] = { id: connPath, filename: connPath, loaded: true, exports: () => pool };

const { setCompanyStaffScope } = require('../mysql/controllers/staff');

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
const sqlsOf = () => recorded.map((r) => r.sql);
const countMatching = (re) => sqlsOf().filter((s) => re.test(s)).length;

// ─── validación de entrada ────────────────────────────────────────────────────

test('setCompanyStaffScope: 400 sin company_id/staff_id', async () => {
  const res = mockRes();
  await setCompanyStaffScope({ body: { locations: [1] } }, res);
  assert.equal(res.statusCode, 400);
});

test('setCompanyStaffScope: 400 cuando no se envía ni locations ni categories', async () => {
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9 } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.msg, /locations or categories/);
});

test('setCompanyStaffScope: 404 cuando el staff no existe/está inactivo en la empresa', async () => {
  pushResults([[]]); // SELECT staffRow → vacío
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, locations: [1] } }, res);
  assert.equal(res.statusCode, 404);
});

test('setCompanyStaffScope: 400 cuando el rol no es location/category-scoped', async () => {
  pushResults([[{ company_staff_id: 'cs-admin', role_level: 1 }]]); // admin
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, locations: [1] } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.msg, /location- or category-scoped/);
});

test('setCompanyStaffScope: 400 cuando la dimensión no corresponde al rol (rol de locación + categories)', async () => {
  pushResults([[{ company_staff_id: 'cs-6', role_level: 6 }]]); // inventory_location_manager
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, categories: [1] } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.msg, /location-scoped/);
});

test('setCompanyStaffScope: 400 cuando un category_id no pertenece a la empresa', async () => {
  pushResults(
    [[{ company_staff_id: 'cs-8', role_level: 8 }]], // staffRow (category role)
    [[{ id: 11 }]],                                   // validación: sólo 11 es válido (12 no)
  );
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, categories: [11, 12] } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.msg, /Invalid category id\(s\).*12/);
  // no debe haber tocado la tabla (sin BEGIN/DELETE)
  assert.equal(countMatching(/^BEGIN$/), 0);
  assert.equal(countMatching(/DELETE FROM staff_category_access/), 0);
});

// ─── happy paths (full-replace transaccional) ──────────────────────────────────

test('setCompanyStaffScope: 200 rol de locación reemplaza el set (DELETE + N INSERT en transacción)', async () => {
  pushResults(
    [[{ company_staff_id: 'cs-6', role_level: 6 }]], // staffRow
    [[{ id: 3 }, { id: 7 }]],                          // validación: ambos válidos
  );
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, locations: [3, 7] } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dimension, 'location');
  assert.equal(res.body.locations_set, 2);
  assert.equal(res.body.categories_set, 0);
  // transacción correcta: BEGIN, 1 DELETE, 2 INSERT, COMMIT, RELEASE
  assert.equal(countMatching(/^BEGIN$/), 1);
  assert.equal(countMatching(/DELETE FROM staff_location_access/), 1);
  assert.equal(countMatching(/INSERT INTO staff_location_access/), 2);
  assert.equal(countMatching(/^COMMIT$/), 1);
  assert.equal(countMatching(/^RELEASE$/), 1);
  assert.equal(countMatching(/staff_category_access/), 0, 'no toca la tabla de categorías');
});

test('setCompanyStaffScope: 200 rol de categoría deduplica ids y hace full-replace', async () => {
  pushResults(
    [[{ company_staff_id: 'cs-8', role_level: 8 }]], // staffRow
    [[{ id: 11 }, { id: 12 }]],                        // validación
  );
  const res = mockRes();
  // 11 duplicado debe colapsar a uno
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, categories: [11, 11, 12] } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dimension, 'category');
  assert.equal(res.body.categories_set, 2);
  assert.equal(countMatching(/DELETE FROM staff_category_access/), 1);
  assert.equal(countMatching(/INSERT INTO staff_category_access/), 2, 'ids duplicados colapsan');
});

test('setCompanyStaffScope: 200 array vacío limpia el scope (DELETE, 0 INSERT)', async () => {
  pushResults([[{ company_staff_id: 'cs-8', role_level: 8 }]]); // staffRow; sin validación porque ids=[]
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, categories: [] } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.categories_set, 0);
  assert.equal(countMatching(/DELETE FROM staff_category_access/), 1);
  assert.equal(countMatching(/INSERT INTO staff_category_access/), 0);
  assert.equal(countMatching(/^COMMIT$/), 1);
});

// ─── write flags (can_*) — role defaults + clamped overrides ────────────────────
// INSERT params order: [uuid, company_staff_id, id, can_create, can_update, can_delete]

const insertFlags = () =>
  recorded
    .filter((r) => /INSERT INTO staff_(location|category)_access/.test(r.sql))
    .map((r) => ({ id: r.params[2], c: r.params[3], u: r.params[4], d: r.params[5] }));

test('setCompanyStaffScope: manager (role 8) por ids → default CRUD (can_create/update/delete=1)', async () => {
  pushResults([[{ company_staff_id: 'cs-8', role_level: 8 }]], [[{ id: 11 }]]);
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, categories: [11] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(insertFlags(), [{ id: 11, c: 1, u: 1, d: 1 }]);
  assert.deepEqual(res.body.default_flags, { can_create: 1, can_update: 1, can_delete: 1 });
});

test('setCompanyStaffScope: assistant (role 9) por ids → sólo update (create=0, delete=0)', async () => {
  pushResults([[{ company_staff_id: 'cs-9', role_level: 9 }]], [[{ id: 20 }]]);
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, categories: [20] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(insertFlags(), [{ id: 20, c: 0, u: 1, d: 0 }]);
});

test('setCompanyStaffScope: override baja permisos de un manager (can_delete:false)', async () => {
  pushResults([[{ company_staff_id: 'cs-6', role_level: 6 }]], [[{ id: 3 }]]);
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, locations: [{ id: 3, can_delete: false }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(insertFlags(), [{ id: 3, c: 1, u: 1, d: 0 }], 'manager con can_delete override a 0, resto default');
});

test('setCompanyStaffScope: override NO puede exceder el rol (assistant + can_delete:true → clamp a 0)', async () => {
  pushResults([[{ company_staff_id: 'cs-9', role_level: 9 }]], [[{ id: 20 }]]);
  const res = mockRes();
  await setCompanyStaffScope({ body: { company_id: 5, staff_id: 9, categories: [{ category_id: 20, can_create: true, can_delete: true }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(insertFlags(), [{ id: 20, c: 0, u: 1, d: 0 }], 'assistant no puede ganar create/delete vía override');
});
