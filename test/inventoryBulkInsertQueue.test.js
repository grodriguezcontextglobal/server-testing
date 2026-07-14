'use strict';

/**
 * insertBulkItemAlhpanumericFormat (mysql/controllers/item.js) hacía el INSERT
 * masivo (hasta 15,000 seriales) de forma síncrona dentro del ciclo
 * request/response, sin transacción real (pool.query por lote, autocommit
 * independiente) y sin idempotencia — un timeout de cliente + retry duplicaba
 * filas. Se migra al mismo patrón que document:upload-pdf: el controller solo
 * valida + encola, y este handler (queue/handlers/inventoryBulkInsert.js) hace
 * el trabajo real dentro de una única transacción con conexión dedicada del
 * pool, igual que el fix ya aplicado en containerItemsDetails/recordEvent.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInventoryBulkInsertHandler, buildExtraInfoMap } = require('../queue/handlers/inventoryBulkInsert');
const { createInsertBulkItemAlphanumeric } = require('../mysql/controllers/item');

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
    category_name: 'Cameras', item_group: 'DSLR', cost: 100, brand: 'Canon',
    descript_item: 'desc', ownership: 'owned', warehouse: true, main_warehouse: 'main',
    created_at: '2026-07-14', update_at: '2026-07-14', company: 'ACME',
    location: 'loc1', location_id: 5, current_location: 'loc1', sub_location: null,
    company_id: 5, return_date: null, container: false, containerSpotLimit: null,
    image_url: null, supplier_info: null,
    list: ['S1', 'S2', 'S3'],
    extra_serial_number: null,
    ...overrides,
  };
}

// ─── buildExtraInfoMap (pure) ─────────────────────────────────────────────────

test('buildExtraInfoMap: parsea el array JSON de extra_serial_number a un mapa por serial', () => {
  const map = buildExtraInfoMap(JSON.stringify([{ S1: { note: 'a' } }, { S2: { note: 'b' } }]));
  assert.deepEqual(map, { S1: { note: 'a' }, S2: { note: 'b' } });
});

test('buildExtraInfoMap: null/undefined/JSON inválido -> mapa vacío (no revienta)', () => {
  assert.deepEqual(buildExtraInfoMap(null), {});
  assert.deepEqual(buildExtraInfoMap(undefined), {});
  assert.deepEqual(buildExtraInfoMap('{not json'), {});
});

// ─── createInventoryBulkInsertHandler ─────────────────────────────────────────

test('inventoryBulkInsertHandler: agrupa en batches, dentro de UNA transacción con conexión dedicada', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 2 }]);
  const pool = { getConnection: async () => conn };
  const handler = createInventoryBulkInsertHandler({ getConnection: () => pool, batchSize: 2 });

  const result = await handler(basePayload({ list: ['S1', 'S2', 'S3'] }));

  assert.equal(conn.calls.beginTransaction, 1, 'debe abrir una sola transacción');
  assert.equal(conn.calls.commit, 1, 'debe commitear una sola vez al final');
  assert.equal(conn.calls.rollback, 0);
  assert.equal(conn.calls.release, 1, 'debe liberar la conexión');
  // batchSize=2 sobre 3 seriales -> 2 queries (batch de 2 + batch de 1)
  assert.equal(conn.calls.execute.length, 2, 'debe ejecutar 1 INSERT por batch, no 1 por serial');
  assert.match(conn.calls.execute[0].sql, /INSERT INTO item_inv/);
  assert.equal(result.inserted, 4); // 2 + 2 affectedRows mockeados
  assert.equal(result.total, 3);
});

test('inventoryBulkInsertHandler: hace rollback y relanza el error si un batch falla a mitad', async () => {
  const conn = makeTrackedConnection(async (_sql, _params, callIndex) => {
    if (callIndex === 2) throw new Error('DB down mid-batch');
    return [{ affectedRows: 2 }];
  });
  const pool = { getConnection: async () => conn };
  const handler = createInventoryBulkInsertHandler({ getConnection: () => pool, batchSize: 2 });

  await assert.rejects(
    () => handler(basePayload({ list: ['S1', 'S2', 'S3', 'S4'] })),
    /DB down mid-batch/
  );

  assert.equal(conn.calls.rollback, 1, 'debe hacer rollback si un batch falla');
  assert.equal(conn.calls.commit, 0, 'no debe commitear si hubo error');
  assert.equal(conn.calls.release, 1, 'debe liberar la conexión incluso si falló');
});

test('inventoryBulkInsertHandler: lista vacía o ausente -> rechaza sin abrir conexión', async () => {
  let getConnectionCalls = 0;
  const pool = { getConnection: async () => { getConnectionCalls++; return makeTrackedConnection(async () => [{ affectedRows: 0 }]); } };
  const handler = createInventoryBulkInsertHandler({ getConnection: () => pool });

  await assert.rejects(() => handler(basePayload({ list: [] })), /no serial numbers provided/);
  await assert.rejects(() => handler(basePayload({ list: undefined })), /no serial numbers provided/);
  assert.equal(getConnectionCalls, 0, 'no debe pedir conexión al pool si no hay nada que insertar');
});

test('inventoryBulkInsertHandler: mergea extra_serial_number por serial en los values del INSERT', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 2 }]);
  const pool = { getConnection: async () => conn };
  const handler = createInventoryBulkInsertHandler({ getConnection: () => pool, batchSize: 10 });

  await handler(basePayload({
    list: ['S1', 'S2'],
    extra_serial_number: JSON.stringify([{ S1: { color: 'red' } }]),
  }));

  const [{ params }] = conn.calls.execute;
  const [values] = params; // VALUES ? -> params[0] es el array de filas
  // Orden de columnas: ...serial_number(6), ...sub_location(15), extra_serial_number(16)
  assert.equal(values[0][6], 'S1');
  assert.deepEqual(JSON.parse(values[0][16]), { color: 'red' });
  assert.equal(values[1][6], 'S2');
  assert.equal(values[1][16], null, 'S2 sin entrada en extra_serial_number -> null');
});

// ─── createInsertBulkItemAlphanumeric (controller, DI) ────────────────────────
// insertBulkItemAlhpanumericFormat migrado al patrón de document:upload-pdf:
// valida + resuelve location_id (síncrono, rápido) y encola el resto —
// responde 202+jobId en vez de esperar el INSERT de hasta 15,000 filas.

function baseBody(overrides = {}) {
  return {
    location: 'Warehouse A',
    company_id: 5,
    list: ['S1', 'S2'],
    ...overrides,
  };
}

test('createInsertBulkItemAlphanumeric: 400 si falta location o company_id (no encola)', async () => {
  let enqueueCalls = 0;
  const controller = createInsertBulkItemAlphanumeric({
    getLocationIdFn: async () => 10,
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: { location: 'Warehouse A' } }, res); // sin company_id
  assert.equal(res.statusCode, 400);
  assert.equal(enqueueCalls, 0);
});

test('createInsertBulkItemAlphanumeric: 404 si la location no existe (no encola)', async () => {
  let enqueueCalls = 0;
  const controller = createInsertBulkItemAlphanumeric({
    getLocationIdFn: async () => null,
    enqueueFn: async () => { enqueueCalls++; return { id: 'J' }; },
  });
  const res = mockRes();

  await controller({ body: baseBody() }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(enqueueCalls, 0);
});

test('createInsertBulkItemAlphanumeric: 202+jobId y encola con location_id resuelto', async () => {
  const calls = [];
  const controller = createInsertBulkItemAlphanumeric({
    getLocationIdFn: async (_conn, companyId, locName) => { assert.equal(companyId, 5); assert.equal(locName, 'Warehouse A'); return 77; },
    enqueueFn: async (type, payload, opts) => { calls.push({ type, payload, opts }); return { id: 'JOB1' }; },
    extractContextFn: () => ({ uid: 'U1', companyId: '5', sqlStaffId: null }),
  });
  const res = mockRes();

  await controller({ body: baseBody(), get: () => undefined }, res);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'inventory:bulk-insert-alphanumeric');
  assert.equal(calls[0].payload.location_id, 77);
  assert.deepEqual(calls[0].payload.list, ['S1', 'S2']);
  assert.equal(calls[0].opts.context.uid, 'U1');
  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.jobId, 'JOB1');
});

test('createInsertBulkItemAlphanumeric: usa el header Idempotency-Key (namespaced)', async () => {
  let capturedOpts;
  const controller = createInsertBulkItemAlphanumeric({
    getLocationIdFn: async () => 77,
    enqueueFn: async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; },
    extractContextFn: () => ({ uid: 'U1', companyId: '5', sqlStaffId: null }),
  });
  const res = mockRes();

  await controller({ body: baseBody(), get: (h) => (h.toLowerCase() === 'idempotency-key' ? 'abc-123' : undefined) }, res);

  assert.equal(capturedOpts.idempotencyKey, 'inventory:bulk-insert-alphanumeric:abc-123');
});

test('createInsertBulkItemAlphanumeric: sin header Idempotency-Key, no manda idempotencyKey', async () => {
  let capturedOpts;
  const controller = createInsertBulkItemAlphanumeric({
    getLocationIdFn: async () => 77,
    enqueueFn: async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; },
    extractContextFn: () => ({ uid: 'U1', companyId: '5', sqlStaffId: null }),
  });
  const res = mockRes();

  await controller({ body: baseBody(), get: () => undefined }, res);

  assert.equal(capturedOpts.idempotencyKey, undefined);
});

test('createInsertBulkItemAlphanumeric: 500 si enqueue falla', async () => {
  const controller = createInsertBulkItemAlphanumeric({
    getLocationIdFn: async () => 77,
    enqueueFn: async () => { throw new Error('Mongo down'); },
    extractContextFn: () => ({ uid: 'U1', companyId: '5', sqlStaffId: null }),
  });
  const res = mockRes();

  await controller({ body: baseBody(), get: () => undefined }, res);
  assert.equal(res.statusCode, 500);
});
