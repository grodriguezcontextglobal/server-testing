'use strict';

/**
 * bulkReturnMemberLeases (mysql/controllers/members.js) hacía las 2
 * escrituras (marcar leases devueltos + reponer inventario) de forma
 * síncrona dentro del ciclo request/response. Sin member_ids/grade, toca
 * TODOS los leases pendientes de la compañía -- sin techo natural, ver
 * project_bulk_queue_migration_plan.md. Se migra al mismo patrón que
 * insertBulkItem: el controller resuelve la lista de leases en scope
 * (lectura rápida, preserva el early-exit "sin leases") y encola; este
 * handler hace las escrituras reales.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createBulkReturnMemberLeasesHandler } = require('../queue/handlers/bulkReturnMemberLeases');

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

function makeLeases(count) {
  return Array.from({ length: count }, (_, i) => ({
    company_id: 137,
    member_id: i + 1,
    device_id: 1000 + i,
  }));
}

// ─── createBulkReturnMemberLeasesHandler ──────────────────────────────────────

test('bulkReturnMemberLeasesHandler: batchea las 2 escrituras dentro de UNA transacción', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 1 }]);
  const pool = { getConnection: async () => conn };
  const handler = createBulkReturnMemberLeasesHandler({ getConnection: () => pool, batchSize: 500 });

  const leases = makeLeases(1200);
  const result = await handler({ company_id: 137, return_status: 'returned', condition_note: null, leases });

  const queryCalls = conn.calls.execute;
  // 1200 leases / 500-per-batch => 3 lease-update batches + 3 restock batches
  assert.equal(queryCalls.length, 6);
  assert.equal(conn.calls.beginTransaction, 1);
  assert.equal(conn.calls.commit, 1);
  assert.equal(conn.calls.rollback, 0);
  assert.equal(conn.calls.release, 1);
  assert.equal(result.returned, 1200);
});

test('bulkReturnMemberLeasesHandler: return_status=lost salta las escrituras de restock', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 1 }]);
  const pool = { getConnection: async () => conn };
  const handler = createBulkReturnMemberLeasesHandler({ getConnection: () => pool });

  const result = await handler({ company_id: 137, return_status: 'lost', condition_note: null, leases: makeLeases(10) });

  assert.equal(conn.calls.execute.length, 1); // solo el UPDATE de leases
  assert.equal(result.devicesRestocked, 0);
});

test('bulkReturnMemberLeasesHandler: hace rollback de AMBAS escrituras si el restock falla', async () => {
  let callCount = 0;
  const conn = makeTrackedConnection(async () => {
    callCount++;
    if (callCount === 2) throw new Error('DB down mid-restock');
    return [{ affectedRows: 1 }];
  });
  const pool = { getConnection: async () => conn };
  const handler = createBulkReturnMemberLeasesHandler({ getConnection: () => pool });

  await assert.rejects(
    () => handler({ company_id: 137, return_status: 'returned', condition_note: null, leases: makeLeases(10) }),
    /DB down mid-restock/
  );

  assert.equal(conn.calls.rollback, 1);
  assert.equal(conn.calls.commit, 0);
  assert.equal(conn.calls.release, 1);
});

test('bulkReturnMemberLeasesHandler: sin leases -> rechaza sin abrir conexión', async () => {
  let getConnectionCalls = 0;
  const pool = { getConnection: async () => { getConnectionCalls++; return makeTrackedConnection(async () => [{}]); } };
  const handler = createBulkReturnMemberLeasesHandler({ getConnection: () => pool });

  await assert.rejects(() => handler({ company_id: 137, return_status: 'returned', leases: [] }), /No leases provided/);
  assert.equal(getConnectionCalls, 0);
});

// ─── createBulkReturnMemberLeases (controller, DI) ────────────────────────────
// La resolución de leases sigue usando la conexión a nivel de módulo (igual
// que antes de migrar), así que hay que swappear mysql/database/config.js
// ANTES de requerir el controller -- mismo patrón que test/batchWriteTransactions.test.js.

const root = path.resolve(__dirname, '..');
const connPath = path.join(root, 'mysql/database/config.js');
const controllerPath = path.join(root, 'mysql/controllers/members.js');

function loadController(leasesResult) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];
  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => ({ query: async () => [leasesResult] }),
  };
  return require('../mysql/controllers/members');
}

test('createBulkReturnMemberLeases: 400 si falta company_id (no encola)', async () => {
  const { createBulkReturnMemberLeases } = loadController([]);
  let enqueueCalls = 0;
  const controller = createBulkReturnMemberLeases({ enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; } });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(enqueueCalls, 0);
});

test('createBulkReturnMemberLeases: 400 si return_status es inválido (no encola)', async () => {
  const { createBulkReturnMemberLeases } = loadController([]);
  let enqueueCalls = 0;
  const controller = createBulkReturnMemberLeases({ enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; } });

  const res = mockRes();
  await controller({ body: { company_id: 137, return_status: 'bogus' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(enqueueCalls, 0);
});

test('createBulkReturnMemberLeases: sin leases en scope, responde 200 directo (no encola) -- comportamiento preservado', async () => {
  const { createBulkReturnMemberLeases } = loadController([]);
  let enqueueCalls = 0;
  const controller = createBulkReturnMemberLeases({ enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; } });

  const res = mockRes();
  await controller({ body: { company_id: 137 } }, res);

  assert.equal(enqueueCalls, 0);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, returned: 0, msg: 'No outstanding leases in scope.' });
});

test('createBulkReturnMemberLeases: si el job termina antes del timeout, responde 200 con el resultado (SIN cambio de contrato)', async () => {
  const leases = [{ company_id: 137, member_id: 1, device_id: 5 }];
  const { createBulkReturnMemberLeases } = loadController(leases);

  const controller = createBulkReturnMemberLeases({
    enqueueFn: async (type, payload) => {
      assert.equal(type, 'member:bulk-return-leases');
      assert.deepEqual(payload.leases, leases);
      return { id: 'JOB1' };
    },
    extractContextFn: () => ({ uid: 'U1', companyId: '137', sqlStaffId: null }),
    waitForJobOutcomeFn: async () => ({
      outcome: 'done',
      result: { returned: 1, devicesRestocked: 1, return_status: 'returned' },
    }),
  });

  const res = mockRes();
  await controller({ body: { company_id: 137 } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, returned: 1, devicesRestocked: 1, return_status: 'returned' });
});

test('createBulkReturnMemberLeases: si el job falla dentro de la espera, responde 500', async () => {
  const { createBulkReturnMemberLeases } = loadController([{ company_id: 137, member_id: 1, device_id: 5 }]);
  const controller = createBulkReturnMemberLeases({
    enqueueFn: async () => ({ id: 'JOB1' }),
    waitForJobOutcomeFn: async () => ({ outcome: 'failed', job: { lastError: 'deadlock' } }),
  });

  const res = mockRes();
  await controller({ body: { company_id: 137 } }, res);

  assert.equal(res.statusCode, 500);
  assert.match(res.payload.msg, /deadlock/);
});

test('createBulkReturnMemberLeases: si se agota el timeout, cae a 202+jobId', async () => {
  const { createBulkReturnMemberLeases } = loadController([{ company_id: 137, member_id: 1, device_id: 5 }]);
  const controller = createBulkReturnMemberLeases({
    enqueueFn: async () => ({ id: 'JOB-BIG' }),
    waitForJobOutcomeFn: async (job) => ({ outcome: 'timeout', job }),
  });

  const res = mockRes();
  await controller({ body: { company_id: 137 } }, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.jobId, 'JOB-BIG');
});
