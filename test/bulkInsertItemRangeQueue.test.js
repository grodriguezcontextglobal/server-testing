'use strict';

/**
 * insertBulkItem (mysql/controllers/item.js) generaba las filas de un rango
 * min/max de serial e insertaba de forma síncrona dentro del ciclo
 * request/response -- sin techo natural (2 números pueden expandir a
 * millones de filas). Se migra al mismo patrón que
 * insertBulkItemAlhpanumericFormat, pero usando waitForJobOutcome para que
 * el caso típico siga respondiendo 201 con la misma forma que antes (ver
 * project_bulk_queue_migration_plan.md) en vez de siempre 202+jobId.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createBulkInsertItemRangeHandler,
  generateSerialNumbers,
  buildRowValues,
} = require('../queue/handlers/bulkInsertItemRange');
const { createInsertBulkItemRange } = require('../mysql/controllers/item');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

function makeTrackedConnection(executeImpl) {
  const calls = { execute: [], beginTransaction: 0, commit: 0, rollback: 0, release: 0 };
  const conn = {
    calls,
    query: async (sql, params) => {
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

function basePayload(overrides = {}) {
  return {
    category_name: 'Laptop', item_group: 'Devices', cost: 100, brand: 'Dell',
    ownership: 'owned', min_serial_number: '000001', max_serial_number: '000003',
    warehouse: 1, main_warehouse: 'main', company: 'Acme', location: 'Main',
    location_id: 5, company_id: 137,
    ...overrides,
  };
}

// ─── generateSerialNumbers / buildRowValues (pure) ────────────────────────────

test('generateSerialNumbers: expande el rango preservando el padding del mínimo', () => {
  assert.deepEqual(generateSerialNumbers('000001', '000003'), ['000001', '000002', '000003']);
});

test('generateSerialNumbers: rango invertido (min > max) -> vacío', () => {
  assert.deepEqual(generateSerialNumbers('5', '1'), []);
});

test('buildRowValues: una fila por serial, mismos campos compartidos', () => {
  const rows = buildRowValues(basePayload(), ['000001', '000002']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][8], '000001'); // serial_number
  assert.equal(rows[1][8], '000002');
  assert.equal(rows[0][0], 'Laptop'); // category_name compartido
});

// ─── createBulkInsertItemRangeHandler ─────────────────────────────────────────

test('bulkInsertItemRangeHandler: agrupa en batches dentro de UNA transacción con conexión dedicada', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 2 }]);
  const pool = { getConnection: async () => conn };
  const handler = createBulkInsertItemRangeHandler({ getConnection: () => pool, batchSize: 2 });

  const result = await handler(basePayload({ min_serial_number: '1', max_serial_number: '5' })); // 5 seriales

  assert.equal(conn.calls.beginTransaction, 1);
  assert.equal(conn.calls.commit, 1);
  assert.equal(conn.calls.rollback, 0);
  assert.equal(conn.calls.release, 1);
  // batchSize=2 sobre 5 seriales -> 3 queries (2+2+1)
  assert.equal(conn.calls.execute.length, 3);
  assert.equal(result.total, 5);
  assert.equal(result.affectedRows, 6); // 3 batches x 2 affectedRows mockeados
});

test('bulkInsertItemRangeHandler: hace rollback y relanza el error si un batch falla', async () => {
  const conn = makeTrackedConnection(async (_sql, _params, callIndex) => {
    if (callIndex === 2) throw new Error('DB down mid-batch');
    return [{ affectedRows: 2 }];
  });
  const pool = { getConnection: async () => conn };
  const handler = createBulkInsertItemRangeHandler({ getConnection: () => pool, batchSize: 2 });

  await assert.rejects(
    () => handler(basePayload({ min_serial_number: '1', max_serial_number: '8' })),
    /DB down mid-batch/
  );

  assert.equal(conn.calls.rollback, 1);
  assert.equal(conn.calls.commit, 0);
  assert.equal(conn.calls.release, 1);
});

test('bulkInsertItemRangeHandler: rango vacío -> rechaza sin abrir conexión', async () => {
  let getConnectionCalls = 0;
  const pool = { getConnection: async () => { getConnectionCalls++; return makeTrackedConnection(async () => [{}]); } };
  const handler = createBulkInsertItemRangeHandler({ getConnection: () => pool });

  await assert.rejects(
    () => handler(basePayload({ min_serial_number: '5', max_serial_number: '1' })),
    /No serial numbers generated/
  );
  assert.equal(getConnectionCalls, 0);
});

// ─── createInsertBulkItemRange (controller, DI) ───────────────────────────────

function baseBody(overrides = {}) {
  return {
    location: 'Main',
    company_id: 137,
    category_name: 'Laptop',
    min_serial_number: '000001',
    max_serial_number: '000003',
    ...overrides,
  };
}

test('createInsertBulkItemRange: 400 si falta location o company_id (no encola)', async () => {
  let enqueueCalls = 0;
  const controller = createInsertBulkItemRange({
    getLocationIdFn: async () => 10,
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: { location: 'Main' } }, res); // sin company_id
  assert.equal(res.statusCode, 400);
  assert.equal(enqueueCalls, 0);
});

test('createInsertBulkItemRange: 404 si la location no existe (no encola)', async () => {
  let enqueueCalls = 0;
  const controller = createInsertBulkItemRange({
    getLocationIdFn: async () => null,
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(enqueueCalls, 0);
});

test('createInsertBulkItemRange: 400 si falta min/max serial number (no encola)', async () => {
  let enqueueCalls = 0;
  const controller = createInsertBulkItemRange({
    getLocationIdFn: async () => 77,
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: baseBody({ min_serial_number: undefined }) }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(enqueueCalls, 0);
});

test('createInsertBulkItemRange: 403 si no hay staff record para la company (no encola)', async () => {
  let enqueueCalls = 0;
  const controller = createInsertBulkItemRange({
    getLocationIdFn: async () => 77,
    getStaffCompanyAccessFn: async () => null,
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(enqueueCalls, 0);
});

test('createInsertBulkItemRange: 403 si el rol scoped no tiene can_create (no encola)', async () => {
  let enqueueCalls = 0;
  const controller = createInsertBulkItemRange({
    getLocationIdFn: async () => 77,
    getStaffCompanyAccessFn: async () => ({ scoped: true, role_level: 8 }),
    canWriteInScopeFn: async () => false,
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(enqueueCalls, 0);
});

test('createInsertBulkItemRange: si el job termina antes del timeout, responde 201 con el resultado (SIN cambio de contrato)', async () => {
  const controller = createInsertBulkItemRange({
    getLocationIdFn: async () => 77,
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async (type, payload) => {
      assert.equal(type, 'inventory:bulk-insert-range');
      assert.equal(payload.location_id, 77);
      return { id: 'JOB1' };
    },
    extractContextFn: () => ({ uid: 'U1', companyId: '137', sqlStaffId: null }),
    waitForJobOutcomeFn: async () => ({ outcome: 'done', result: { affectedRows: 3, insertId: 1, total: 3 } }),
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.payload, { item: { affectedRows: 3, insertId: 1, total: 3 }, ok: true });
});

test('createInsertBulkItemRange: si el job falla dentro de la espera, responde 500 con el error real', async () => {
  const controller = createInsertBulkItemRange({
    getLocationIdFn: async () => 77,
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async () => ({ id: 'JOB1' }),
    waitForJobOutcomeFn: async () => ({ outcome: 'failed', job: { lastError: 'constraint violation' } }),
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
  assert.match(res.payload.msg, /constraint violation/);
});

test('createInsertBulkItemRange: si se agota el timeout, cae a 202+jobId (caso raro)', async () => {
  const controller = createInsertBulkItemRange({
    getLocationIdFn: async () => 77,
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async () => ({ id: 'JOB-BIG' }),
    waitForJobOutcomeFn: async (job) => ({ outcome: 'timeout', job }),
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.jobId, 'JOB-BIG');
});

test('createInsertBulkItemRange: 500 si enqueue falla', async () => {
  const controller = createInsertBulkItemRange({
    getLocationIdFn: async () => 77,
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async () => { throw new Error('Mongo down'); },
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);
  assert.equal(res.statusCode, 500);
});
