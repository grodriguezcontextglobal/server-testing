'use strict';

/**
 * deleteBulkItemBasedOnCriteria (mysql/controllers/item.js) borraba por
 * criterio de forma síncrona dentro del ciclo request/response. Sin
 * serial_number, borra TODA una categoría/ubicación del inventario -- sin
 * techo natural, ver project_bulk_queue_migration_plan.md. Se migra al
 * mismo patrón que insertBulkItem/bulkReturnMemberLeases: el controller
 * resuelve el scope (rápido) y encola; este handler arma el WHERE y corre
 * el DELETE real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDeleteBulkItemBasedOnCriteriaHandler,
} = require('../queue/handlers/deleteBulkItemBasedOnCriteria');
const { createDeleteBulkItemBasedOnCriteria } = require('../mysql/controllers/item');

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
    execute: async (sql, values) => {
      calls.execute.push({ sql: sql.trim(), values });
      return executeImpl(sql.trim(), values, calls.execute.length);
    },
    beginTransaction: async () => { calls.beginTransaction++; },
    commit: async () => { calls.commit++; },
    rollback: async () => { calls.rollback++; },
    release: () => { calls.release++; },
  };
  return conn;
}

// ─── createDeleteBulkItemBasedOnCriteriaHandler ───────────────────────────────

test('deleteBulkItemBasedOnCriteriaHandler: sin serial_number, corre 1 solo DELETE', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 10 }]);
  const pool = { getConnection: async () => conn };
  const handler = createDeleteBulkItemBasedOnCriteriaHandler({ getConnection: () => pool });

  const result = await handler({ company_id: 137, category_name: 'Laptop', item_group: null, serial_number: null, location_ids: null });

  assert.equal(conn.calls.execute.length, 1);
  assert.match(conn.calls.execute[0].sql, /DELETE FROM item_inv WHERE company_id = \? AND category_name = \?/);
  assert.equal(conn.calls.beginTransaction, 1);
  assert.equal(conn.calls.commit, 1);
  assert.equal(result.deletedCount, 10);
});

test('deleteBulkItemBasedOnCriteriaHandler: incluye location_id IN (...) cuando location_ids viene resuelto', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 3 }]);
  const pool = { getConnection: async () => conn };
  const handler = createDeleteBulkItemBasedOnCriteriaHandler({ getConnection: () => pool });

  await handler({ company_id: 137, category_name: 'Laptop', item_group: null, serial_number: null, location_ids: [1, 2] });

  assert.match(conn.calls.execute[0].sql, /location_id IN \(\?,\?\)/);
  assert.deepEqual(conn.calls.execute[0].values, [137, 'Laptop', 1, 2]);
});

test('deleteBulkItemBasedOnCriteriaHandler: batchea el serial_number IN (...) dentro de UNA transacción', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 1 }]);
  const pool = { getConnection: async () => conn };
  const handler = createDeleteBulkItemBasedOnCriteriaHandler({ getConnection: () => pool, batchSize: 500 });

  const serial_number = Array.from({ length: 1200 }, (_, i) => `SN-${i}`);
  const result = await handler({ company_id: 137, category_name: 'Laptop', item_group: null, serial_number, location_ids: null });

  // 1200 seriales / 500-per-batch => 3 DELETEs
  assert.equal(conn.calls.execute.length, 3);
  assert.equal(conn.calls.beginTransaction, 1);
  assert.equal(conn.calls.commit, 1);
  assert.equal(conn.calls.rollback, 0);
  assert.equal(result.deletedCount, 3);
});

test('deleteBulkItemBasedOnCriteriaHandler: rollback si un batch falla', async () => {
  let callIndex = 0;
  const conn = makeTrackedConnection(async () => {
    callIndex++;
    if (callIndex === 2) throw new Error('lock timeout');
    return [{ affectedRows: 1 }];
  });
  const pool = { getConnection: async () => conn };
  const handler = createDeleteBulkItemBasedOnCriteriaHandler({ getConnection: () => pool, batchSize: 500 });

  const serial_number = Array.from({ length: 1200 }, (_, i) => `SN-${i}`);
  await assert.rejects(
    () => handler({ company_id: 137, category_name: 'Laptop', item_group: null, serial_number, location_ids: null }),
    /lock timeout/
  );

  assert.equal(conn.calls.rollback, 1);
  assert.equal(conn.calls.commit, 0);
  assert.equal(conn.calls.release, 1);
});

// ─── createDeleteBulkItemBasedOnCriteria (controller, DI) ─────────────────────

function baseBody(overrides = {}) {
  return { company_id: 137, category_name: 'Laptop', ...overrides };
}

test('createDeleteBulkItemBasedOnCriteria: 400 si falta company_id o category_name (no encola)', async () => {
  let enqueueCalls = 0;
  const controller = createDeleteBulkItemBasedOnCriteria({
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: { company_id: 137 } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(enqueueCalls, 0);
});

test('createDeleteBulkItemBasedOnCriteria: 403 si no hay staff record (no encola)', async () => {
  let enqueueCalls = 0;
  const controller = createDeleteBulkItemBasedOnCriteria({
    getStaffCompanyAccessFn: async () => null,
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(enqueueCalls, 0);
});

test('createDeleteBulkItemBasedOnCriteria: categoría fuera de scope -> 200 directo, no encola (comportamiento preservado)', async () => {
  let enqueueCalls = 0;
  const controller = createDeleteBulkItemBasedOnCriteria({
    getStaffCompanyAccessFn: async () => ({ scoped: true, role_level: 8 }),
    getWritableScopeFn: async () => ({ dimension: 'category', values: ['Cameras'] }),
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: baseBody({ category_name: 'Laptop' }) }, res);

  assert.equal(enqueueCalls, 0);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    deleted_count: 0,
    msg: 'Category not within your permitted scope. No changes were made.',
    ok: true,
  });
});

test('createDeleteBulkItemBasedOnCriteria: sin ubicaciones permitidas -> 200 directo, no encola', async () => {
  let enqueueCalls = 0;
  const controller = createDeleteBulkItemBasedOnCriteria({
    getStaffCompanyAccessFn: async () => ({ scoped: true, role_level: 6 }),
    getWritableScopeFn: async () => ({ dimension: 'location', values: [] }),
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);

  assert.equal(enqueueCalls, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.msg, 'No locations within your permitted scope. No changes were made.');
});

test('createDeleteBulkItemBasedOnCriteria: rol location-scoped permitido, encola con location_ids resueltos', async () => {
  let capturedPayload;
  const controller = createDeleteBulkItemBasedOnCriteria({
    getStaffCompanyAccessFn: async () => ({ scoped: true, role_level: 6 }),
    getWritableScopeFn: async () => ({ dimension: 'location', values: [1, 2] }),
    enqueueFn: async (type, payload) => { capturedPayload = payload; return { id: 'JOB1' }; },
    waitForJobOutcomeFn: async () => ({ outcome: 'done', result: { deletedCount: 5 } }),
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);

  assert.deepEqual(capturedPayload.location_ids, [1, 2]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.deleted_count, 5);
});

test('createDeleteBulkItemBasedOnCriteria: si el job termina antes del timeout y deletedCount=0, responde el mensaje "no items found"', async () => {
  const controller = createDeleteBulkItemBasedOnCriteria({
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async () => ({ id: 'JOB1' }),
    waitForJobOutcomeFn: async () => ({ outcome: 'done', result: { deletedCount: 0 } }),
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    deleted_count: 0,
    msg: 'No items found matching the provided criteria. No changes were made.',
    ok: true,
  });
});

test('createDeleteBulkItemBasedOnCriteria: si el job termina antes del timeout con resultados, responde el mensaje de éxito', async () => {
  const controller = createDeleteBulkItemBasedOnCriteria({
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async () => ({ id: 'JOB1' }),
    waitForJobOutcomeFn: async () => ({ outcome: 'done', result: { deletedCount: 7 } }),
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);

  assert.deepEqual(res.payload, { deleted_count: 7, msg: '7 item(s) deleted successfully.', ok: true });
});

test('createDeleteBulkItemBasedOnCriteria: si el job falla dentro de la espera, responde 500', async () => {
  const controller = createDeleteBulkItemBasedOnCriteria({
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async () => ({ id: 'JOB1' }),
    waitForJobOutcomeFn: async () => ({ outcome: 'failed', job: { lastError: 'deadlock' } }),
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.error, 'deadlock');
});

test('createDeleteBulkItemBasedOnCriteria: si se agota el timeout, cae a 202+jobId', async () => {
  const controller = createDeleteBulkItemBasedOnCriteria({
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async () => ({ id: 'JOB-BIG' }),
    waitForJobOutcomeFn: async (job) => ({ outcome: 'timeout', job }),
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.jobId, 'JOB-BIG');
});

test('createDeleteBulkItemBasedOnCriteria: 500 si enqueue falla', async () => {
  const controller = createDeleteBulkItemBasedOnCriteria({
    getStaffCompanyAccessFn: async () => ({ scoped: false }),
    enqueueFn: async () => { throw new Error('Mongo down'); },
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);
  assert.equal(res.statusCode, 500);
});
