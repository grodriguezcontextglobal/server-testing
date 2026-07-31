'use strict';

/**
 * insertBulkMembers (mysql/controllers/members.js) hacía el INSERT masivo
 * de forma síncrona dentro del ciclo request/response. Un import CSV a
 * nivel de distrito escolar puede ser miles de filas (ver
 * project_bulk_queue_migration_plan.md). Se migra al mismo patrón que los
 * otros 3: el controller normaliza/resuelve columnas (rápido) y encola;
 * este handler hace el INSERT real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBulkInsertMembersHandler } = require('../queue/handlers/bulkInsertMembers');

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

function makeRows(count) {
  return Array.from({ length: count }, (_, i) => ({
    first_name: `First${i}`,
    last_name: `Last${i}`,
    company_id: '137',
  }));
}

// ─── createBulkInsertMembersHandler ───────────────────────────────────────────

test('bulkInsertMembersHandler: batchea el INSERT dentro de UNA transacción', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 1 }]);
  const pool = { getConnection: async () => conn };
  const handler = createBulkInsertMembersHandler({ getConnection: () => pool, batchSize: 500 });

  const result = await handler({ valid: makeRows(1200), columns: ['first_name', 'last_name', 'company_id'] });

  // 1200 rows / 500-per-batch => 3 INSERTs
  assert.equal(conn.calls.execute.length, 3);
  assert.equal(conn.calls.beginTransaction, 1);
  assert.equal(conn.calls.commit, 1);
  assert.equal(conn.calls.rollback, 0);
  assert.equal(conn.calls.release, 1);
  assert.equal(result.affectedRows, 3); // 3 batches x 1 affectedRows mockeado
});

test('bulkInsertMembersHandler: hace rollback y relanza el error si un batch falla', async () => {
  let callIndex = 0;
  const conn = makeTrackedConnection(async () => {
    callIndex++;
    if (callIndex === 2) throw new Error('DB down mid-batch');
    return [{ affectedRows: 1 }];
  });
  const pool = { getConnection: async () => conn };
  const handler = createBulkInsertMembersHandler({ getConnection: () => pool, batchSize: 500 });

  await assert.rejects(
    () => handler({ valid: makeRows(1200), columns: ['first_name', 'last_name'] }),
    /DB down mid-batch/
  );

  assert.equal(conn.calls.rollback, 1);
  assert.equal(conn.calls.commit, 0);
  assert.equal(conn.calls.release, 1);
});

test('bulkInsertMembersHandler: sin filas válidas -> rechaza sin abrir conexión', async () => {
  let getConnectionCalls = 0;
  const pool = { getConnection: async () => { getConnectionCalls++; return makeTrackedConnection(async () => [{}]); } };
  const handler = createBulkInsertMembersHandler({ getConnection: () => pool });

  await assert.rejects(() => handler({ valid: [], columns: ['first_name'] }), /No valid rows provided/);
  assert.equal(getConnectionCalls, 0);
});

// ─── createInsertBulkMembers (controller) ─────────────────────────────────────
// SHOW COLUMNS sigue corriendo sobre la conexión a nivel de módulo, así que
// hay que swappear mysql/database/config.js ANTES de requerir el
// controller -- mismo patrón que bulkReturnMemberLeasesQueue.test.js.

const root = path.resolve(__dirname, '..');
const connPath = path.join(root, 'mysql/database/config.js');
const controllerPath = path.join(root, 'mysql/controllers/members.js');

const SCHEMA_COLUMNS = [
  'first_name', 'last_name', 'email', 'phone_number', 'external_id',
  'address', 'address_street', 'address_city', 'address_state', 'address_zip',
  'company_id', 'grade', 'homeroom', 'date_of_birth', 'minor',
  'parent_guardian_first_name', 'parent_guardian_last_name',
  'parent_guardian_email', 'parent_guardian_phone_number',
].map((Field) => ({ Field }));

function loadController() {
  delete require.cache[connPath];
  delete require.cache[controllerPath];
  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => ({ query: async () => [SCHEMA_COLUMNS] }),
  };
  return require('../mysql/controllers/members');
}

test('createInsertBulkMembers: 400 si no se manda un array de filas (no encola)', async () => {
  const { createInsertBulkMembers } = loadController();
  let enqueueCalls = 0;
  const controller = createInsertBulkMembers({ enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; } });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(enqueueCalls, 0);
});

test('createInsertBulkMembers: 400 si ninguna fila tiene first_name/last_name (no encola)', async () => {
  const { createInsertBulkMembers } = loadController();
  let enqueueCalls = 0;
  const controller = createInsertBulkMembers({ enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; } });

  const res = mockRes();
  await controller({ body: { rows: [{ email: 'a@b.com' }] } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(enqueueCalls, 0);
});

test('createInsertBulkMembers: si el job termina antes del timeout, responde 201 con el resultado (SIN cambio de contrato)', async () => {
  const { createInsertBulkMembers } = loadController();
  let capturedPayload;
  const controller = createInsertBulkMembers({
    enqueueFn: async (type, payload) => { capturedPayload = payload; return { id: 'JOB1' }; },
    extractContextFn: () => ({ uid: 'U1', companyId: '137', sqlStaffId: null }),
    waitForJobOutcomeFn: async () => ({ outcome: 'done', result: { affectedRows: 2, insertId: 10 } }),
  });

  const res = mockRes();
  await controller({
    body: { rows: [
      { first_name: 'A', last_name: 'One', company_id: 137 },
      { first_name: 'B', last_name: 'Two', company_id: 137 },
    ] },
  }, res);

  assert.equal(capturedPayload.valid.length, 2);
  assert.ok(capturedPayload.columns.includes('first_name'));
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.requested, 2);
  assert.equal(res.payload.inserted, 2);
  assert.equal(res.payload.affectedRows, 2);
  assert.equal(res.payload.insertId, 10);
});

test('createInsertBulkMembers: reporta skipped para filas sin first_name/last_name que sí encolan las válidas', async () => {
  const { createInsertBulkMembers } = loadController();
  const controller = createInsertBulkMembers({
    enqueueFn: async () => ({ id: 'JOB1' }),
    waitForJobOutcomeFn: async () => ({ outcome: 'done', result: { affectedRows: 1, insertId: 1 } }),
  });

  const res = mockRes();
  await controller({
    body: { rows: [
      { first_name: 'A', last_name: 'One', company_id: 137 },
      { email: 'no-name@x.com' },
    ] },
  }, res);

  assert.equal(res.payload.requested, 2);
  assert.equal(res.payload.inserted, 1);
  assert.equal(res.payload.skipped, 1);
});

test('createInsertBulkMembers: si el job falla dentro de la espera, responde 500', async () => {
  const { createInsertBulkMembers } = loadController();
  const controller = createInsertBulkMembers({
    enqueueFn: async () => ({ id: 'JOB1' }),
    waitForJobOutcomeFn: async () => ({ outcome: 'failed', job: { lastError: 'constraint violation' } }),
  });

  const res = mockRes();
  await controller({ body: { rows: [{ first_name: 'A', last_name: 'One' }] } }, res);

  assert.equal(res.statusCode, 500);
  assert.match(res.payload.msg, /constraint violation/);
});

test('createInsertBulkMembers: si se agota el timeout, cae a 202+jobId', async () => {
  const { createInsertBulkMembers } = loadController();
  const controller = createInsertBulkMembers({
    enqueueFn: async () => ({ id: 'JOB-BIG' }),
    waitForJobOutcomeFn: async (job) => ({ outcome: 'timeout', job }),
  });

  const res = mockRes();
  await controller({ body: { rows: [{ first_name: 'A', last_name: 'One' }] } }, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.jobId, 'JOB-BIG');
});
