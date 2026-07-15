'use strict';

/**
 * updateItemsBasedOnAlphanumericSerialNumber (mysql/controllers/item.js) hacía
 * el UPDATE masivo de forma síncrona dentro del ciclo request/response,
 * sosteniendo la conexión HTTP mientras tocaba potencialmente miles de filas
 * (updateAll por criterio, o listas grandes de seriales). Se migra al patrón
 * genérico de la cola (createQueuedJobController, igual que
 * insertingDeviceInEventDirectlyFromContainer): el controller solo valida
 * (resolveUpdatePlan, sin DB) y encola; el UPDATE real vive en
 * queue/handlers/inventoryBulkUpdateAlphanumeric.js dentro de una única
 * transacción con conexión dedicada del pool.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInventoryBulkUpdateAlphanumericHandler,
  resolveUpdatePlan,
  buildExtraSerialNumberMap,
} = require('../queue/handlers/inventoryBulkUpdateAlphanumeric');

function makeTrackedConnection(executeImpl) {
  const calls = { execute: [], beginTransaction: 0, commit: 0, rollback: 0, release: 0 };
  const conn = {
    calls,
    execute: async (sql, params) => {
      calls.execute.push({ sql: sql.trim(), params });
      return executeImpl(sql.trim(), params, calls.execute.length);
    },
    beginTransaction: async () => { calls.beginTransaction++; },
    commit: async () => { calls.commit++; },
    rollback: async () => { calls.rollback++; },
    release: () => { calls.release++; },
  };
  return conn;
}

// ─── buildExtraSerialNumberMap (pure) ─────────────────────────────────────────

test('buildExtraSerialNumberMap: parsea y descarta las entradas item_id', () => {
  const map = buildExtraSerialNumberMap(JSON.stringify([
    { '5001': [{ keyObject: 'Serial Number', valueObject: '5001' }, { keyObject: 'item_id', valueObject: 57105 }] },
  ]));
  assert.deepEqual(JSON.parse(map.get('5001')), [{ keyObject: 'Serial Number', valueObject: '5001' }]);
});

test('buildExtraSerialNumberMap: null/undefined -> mapa vacío', () => {
  assert.equal(buildExtraSerialNumberMap(null).size, 0);
  assert.equal(buildExtraSerialNumberMap(undefined).size, 0);
});

test('buildExtraSerialNumberMap: JSON inválido o no-array -> lanza', () => {
  assert.throws(() => buildExtraSerialNumberMap('{not json'), /invalid JSON/);
  assert.throws(() => buildExtraSerialNumberMap(JSON.stringify({ a: 1 })), /must be a JSON array/);
});

// ─── resolveUpdatePlan (pure) ──────────────────────────────────────────────────

test('resolveUpdatePlan: 400 si falta company_id', () => {
  const plan = resolveUpdatePlan({ list: ['S1'], brand: 'Canon' });
  assert.equal(plan.error.status, 400);
  assert.match(plan.error.msg, /company_id is required/);
});

test('resolveUpdatePlan: updateAll sin reference válida -> 400', () => {
  const plan = resolveUpdatePlan({ company_id: 5, updateAll: true, brand: 'Canon', reference: {} });
  assert.equal(plan.error.status, 400);
  assert.match(plan.error.msg, /reference must include/);
});

test('resolveUpdatePlan: updateAll sin campos a actualizar -> 400', () => {
  const plan = resolveUpdatePlan({ company_id: 5, updateAll: true, reference: { brand: 'Canon' } });
  assert.equal(plan.error.status, 400);
  assert.match(plan.error.msg, /At least one field/);
});

test('resolveUpdatePlan: updateAll válido -> mode updateAll con entries resueltas', () => {
  const plan = resolveUpdatePlan({
    company_id: 5,
    updateAll: true,
    reference: { item_group: 'DSLR', unknownKey: 'x' },
    brand: 'Sony',
  });
  assert.equal(plan.mode, 'updateAll');
  assert.deepEqual(plan.referenceEntries, [['item_group', 'DSLR']]);
  assert.deepEqual(plan.baseEntries, [['brand', 'Sony']]);
});

test('resolveUpdatePlan: list vacía y sin extra_serial_number -> 400', () => {
  const plan = resolveUpdatePlan({ company_id: 5, brand: 'Sony', list: [] });
  assert.equal(plan.error.status, 400);
  assert.match(plan.error.msg, /Provide list or extra_serial_number/);
});

test('resolveUpdatePlan: list sin campos ni extra_serial_number -> 400', () => {
  const plan = resolveUpdatePlan({ company_id: 5, list: ['S1'] });
  assert.equal(plan.error.status, 400);
  assert.match(plan.error.msg, /At least one field/);
});

test('resolveUpdatePlan: list válida -> mode list con effectiveList/extraSerialMap', () => {
  const plan = resolveUpdatePlan({ company_id: 5, list: ['S1', 'S2'], brand: 'Sony' });
  assert.equal(plan.mode, 'list');
  assert.deepEqual(plan.effectiveList, ['S1', 'S2']);
  assert.deepEqual(plan.baseEntries, [['brand', 'Sony']]);
});

test('resolveUpdatePlan: extra_serial_number inválido -> 400 (no DB)', () => {
  const plan = resolveUpdatePlan({ company_id: 5, list: ['S1'], extra_serial_number: '{bad' });
  assert.equal(plan.error.status, 400);
  assert.match(plan.error.msg, /invalid JSON/);
});

// ─── createInventoryBulkUpdateAlphanumericHandler ─────────────────────────────

test('handler: modo updateAll ejecuta un UPDATE dentro de una transacción y devuelve updated_count', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 7 }]);
  const pool = { getConnection: async () => conn };
  const handler = createInventoryBulkUpdateAlphanumericHandler({ getConnection: () => pool });

  const result = await handler({
    company_id: 5,
    updateAll: true,
    reference: { category_name: 'Cameras' },
    brand: 'Canon',
  });

  assert.equal(conn.calls.beginTransaction, 1);
  assert.equal(conn.calls.commit, 1);
  assert.equal(conn.calls.rollback, 0);
  assert.equal(conn.calls.release, 1);
  assert.equal(conn.calls.execute.length, 1);
  assert.match(conn.calls.execute[0].sql, /UPDATE item_inv SET/);
  assert.match(conn.calls.execute[0].sql, /WHERE company_id = \? AND category_name = \?/);
  assert.equal(result.updated_count, 7);
});

test('handler: modo list construye CASE WHEN por extra_serial_number', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 2 }]);
  const pool = { getConnection: async () => conn };
  const handler = createInventoryBulkUpdateAlphanumericHandler({ getConnection: () => pool });

  await handler({
    company_id: 5,
    list: ['S1', 'S2'],
    brand: 'Sony',
    extra_serial_number: JSON.stringify([{ S1: [{ keyObject: 'color', valueObject: 'red' }] }]),
  });

  const [{ sql, params }] = conn.calls.execute;
  assert.match(sql, /CASE serial_number WHEN \? THEN \?/);
  assert.match(sql, /WHERE company_id = \? AND serial_number IN \(\?, \?\)/);
  // setValues: brand, update_at, then WHEN/THEN pair for S1
  assert.equal(params[0], 'Sony');
  assert.equal(params[2], 'S1');
});

test('handler: hace rollback y relanza el error si el UPDATE falla', async () => {
  const conn = makeTrackedConnection(async () => { throw new Error('DB down'); });
  const pool = { getConnection: async () => conn };
  const handler = createInventoryBulkUpdateAlphanumericHandler({ getConnection: () => pool });

  await assert.rejects(
    () => handler({ company_id: 5, list: ['S1'], brand: 'Sony' }),
    /DB down/,
  );
  assert.equal(conn.calls.rollback, 1);
  assert.equal(conn.calls.commit, 0);
  assert.equal(conn.calls.release, 1);
});

test('handler: payload inválido (sin controller de por medio) lanza en vez de ejecutar query', async () => {
  let getConnectionCalls = 0;
  const pool = { getConnection: async () => { getConnectionCalls++; return makeTrackedConnection(async () => [{ affectedRows: 0 }]); } };
  const handler = createInventoryBulkUpdateAlphanumericHandler({ getConnection: () => pool });

  await assert.rejects(() => handler({ list: ['S1'] }), /company_id is required/);
  assert.equal(getConnectionCalls, 0, 'no debe pedir conexión si el payload es inválido');
});
