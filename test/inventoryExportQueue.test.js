'use strict';

/**
 * El handler del export (queue/handlers/inventoryExport.js) y el controller que
 * lo encola (mysql/controllers/inventoryExport.js).
 *
 * Contrato pedido en FRONTEND_inventory_export_contract_2026-09-17.md §3:
 * 202 + jobId al encolar, y al terminar `{ url, expiresAt, rowCount, fileName }`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInventoryExportHandler,
  DOWNLOAD_URL_MINUTES,
} = require('../queue/handlers/inventoryExport');
const { createPostInventoryExport } = require('../mysql/controllers/inventoryExport');
const { EXPORT_CHUNK_SIZE } = require('../mysql/queries/inventoryExportQuery');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

/** Escritor de libro falso: guarda las filas en vez de escribir un .xlsx. */
function fakeWriter() {
  const rows = [];
  let committed = false;
  return {
    rows,
    get committed() { return committed; },
    create: () => ({
      addRow: (values) => rows.push(values),
      commit: async () => { committed = true; },
    }),
  };
}

function makeItem(id, overrides = {}) {
  return {
    item_id: id,
    serial_number: `SN-${id}`,
    warehouse: 1,
    location: 'Miami',
    brand: 'Dell',
    category_name: 'Laptop',
    item_group: 'Latitude',
    ownership: 'Permanent',
    cost: '1200.00',
    status: 'Good',
    main_warehouse: 'FL',
    enableAssignFeature: 1,
    return_date: null,
    extra_serial_number: null,
    descript_item: 'x',
    image_url: 'https://example.com/a.png',
    ...overrides,
  };
}

/**
 * Conexión falsa que sirve `pages` de item_inv por orden, y responde al lote de
 * eventos con `assignments`.
 */
function makeConnection(pages, assignments = []) {
  const calls = [];
  let page = 0;
  return {
    calls,
    execute: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('item_inv_assigned_event')) return [assignments];
      const rows = pages[page] || [];
      page += 1;
      return [rows];
    },
  };
}

test('un export corto: una consulta, cabecera aparte y el payload del contrato', async () => {
  const writer = fakeWriter();
  const connection = makeConnection([[makeItem(1), makeItem(2)]]);

  const handler = createInventoryExportHandler({
    getConnection: () => connection,
    uploadExport: async ({ filePath, companyId, fileName }) => {
      assert.match(filePath, /inventory-export-job-1\.xlsx$/);
      assert.equal(companyId, 7);
      assert.equal(fileName, 'inventory-7-2026-09-17.xlsx');
      return { key: 'companies/7/inventory-exports/1-inventory.xlsx' };
    },
    getDownloadUrl: async (key, minutes) => {
      assert.equal(minutes, DOWNLOAD_URL_MINUTES);
      return `https://s3/${key}?sig=abc`;
    },
    createWorkbookWriter: writer.create,
    now: () => new Date('2026-09-17T12:00:00Z'),
  });

  const result = await handler(
    { companyId: 7, access: { scoped: false }, fileName: 'inventory-7-2026-09-17.xlsx' },
    { id: 'job-1' }
  );

  assert.deepEqual(result, {
    url: 'https://s3/companies/7/inventory-exports/1-inventory.xlsx?sig=abc',
    expiresAt: '2026-09-17T12:15:00.000Z',
    rowCount: 2,
    fileName: 'inventory-7-2026-09-17.xlsx',
  });
  assert.equal(writer.rows.length, 2, 'la cabecera no cuenta como fila de datos');
  assert.ok(writer.committed, 'el libro tiene que cerrarse');
});

test('un trozo lleno pide el siguiente; uno incompleto termina', async () => {
  const full = Array.from({ length: EXPORT_CHUNK_SIZE }, (_, i) => makeItem(i + 1));
  const connection = makeConnection([full, [makeItem(9001)]]);
  const writer = fakeWriter();

  const handler = createInventoryExportHandler({
    getConnection: () => connection,
    uploadExport: async () => ({ key: 'k' }),
    getDownloadUrl: async () => 'https://s3/k',
    createWorkbookWriter: writer.create,
  });

  const result = await handler({ companyId: 7, access: { scoped: false } }, { id: 'j' });

  assert.equal(result.rowCount, EXPORT_CHUNK_SIZE + 1);
  // Dos consultas de inventario y ninguna tercera: el trozo incompleto corta el
  // bucle sin pedir una página vacía para descubrirlo.
  const itemQueries = connection.calls.filter((c) => !c.sql.includes('item_inv_assigned_event'));
  assert.equal(itemQueries.length, 2);
  // Y la segunda va con cursor: el keyset avanzó.
  assert.ok(itemQueries[1].params.length > itemQueries[0].params.length);
});

test('solo pide eventos para los que NO están en stock', async () => {
  const connection = makeConnection(
    [[makeItem(1), makeItem(2, { warehouse: 0 })]],
    [{ item_id: 2, event_name: 'NAB 2026', condition: 'Damaged' }]
  );
  const writer = fakeWriter();

  const handler = createInventoryExportHandler({
    getConnection: () => connection,
    uploadExport: async () => ({ key: 'k' }),
    getDownloadUrl: async () => 'https://s3/k',
    createWorkbookWriter: writer.create,
  });

  await handler({ companyId: 7, access: { scoped: false } }, { id: 'j' });

  const lookup = connection.calls.find((c) => c.sql.includes('item_inv_assigned_event'));
  assert.deepEqual(lookup.params, [2], 'el ítem en stock no entra en el lote');

  // El ítem fuera de stock recibe su event_name: es la columna que la hoja del
  // navegador deja vacía hoy, porque warehouse-items nunca trajo el campo.
  assert.equal(writer.rows[0][2], 'Miami (In-Stock)');
  assert.equal(writer.rows[1][2], 'NAB 2026 (In-Use)');
  assert.equal(writer.rows[1][9], 'NAB 2026');
});

test('un trozo entero en stock no consulta eventos', async () => {
  const connection = makeConnection([[makeItem(1), makeItem(2)]]);
  const writer = fakeWriter();

  const handler = createInventoryExportHandler({
    getConnection: () => connection,
    uploadExport: async () => ({ key: 'k' }),
    getDownloadUrl: async () => 'https://s3/k',
    createWorkbookWriter: writer.create,
  });

  await handler({ companyId: 7, access: { scoped: false } }, { id: 'j' });

  assert.equal(connection.calls.filter((c) => c.sql.includes('item_inv_assigned_event')).length, 0);
});

test('el scope del rol se reconstruye desde el access del job', async () => {
  const connection = makeConnection([[]]);
  const handler = createInventoryExportHandler({
    getConnection: () => connection,
    uploadExport: async () => ({ key: 'k' }),
    getDownloadUrl: async () => 'https://s3/k',
    createWorkbookWriter: fakeWriter().create,
  });

  // role_level 6 = location_manager (LOCATION_SCOPED_ROLES = {6,7}).
  await handler(
    {
      companyId: 7,
      access: { scoped: true, role_level: 6, locations: [3, 4], categoryNames: [] },
    },
    { id: 'j' }
  );

  // El filtro de locación entra DENTRO del WHERE, no se aplica después.
  assert.match(connection.calls[0].sql, /location_id IN \(\?,\?\)/);
  assert.deepEqual(connection.calls[0].params, [7, 3, 4]);
});

test('un rol con scope de categoría exporta solo sus categorías', async () => {
  const connection = makeConnection([[]]);
  const handler = createInventoryExportHandler({
    getConnection: () => connection,
    uploadExport: async () => ({ key: 'k' }),
    getDownloadUrl: async () => 'https://s3/k',
    createWorkbookWriter: fakeWriter().create,
  });

  // role_level 8 = category_manager (CATEGORY_SCOPED_ROLES = {8,9}).
  await handler(
    {
      companyId: 7,
      access: { scoped: true, role_level: 8, locations: [], categoryNames: ['Laptop'] },
    },
    { id: 'j' }
  );

  assert.match(connection.calls[0].sql, /category_name IN \(\?\)/);
  assert.deepEqual(connection.calls[0].params, [7, 'Laptop']);
});

test('un rol con scope y sin asignaciones no exporta nada', async () => {
  const connection = makeConnection([[]]);
  const handler = createInventoryExportHandler({
    getConnection: () => connection,
    uploadExport: async () => ({ key: 'k' }),
    getDownloadUrl: async () => 'https://s3/k',
    createWorkbookWriter: fakeWriter().create,
  });

  // Fail-closed: un rol con scope y sin asignaciones no ve NADA, en vez de
  // verlo todo por ausencia de filtro.
  const result = await handler(
    { companyId: 7, access: { scoped: true, role_level: 6, locations: [], categoryNames: [] } },
    { id: 'j' }
  );

  assert.match(connection.calls[0].sql, /1=0/);
  assert.equal(result.rowCount, 0);
});

// ─── Controller ──────────────────────────────────────────────────────────────

test('encolar responde 202 con el jobId', async () => {
  const res = mockRes();
  let enqueued = null;

  const handler = createPostInventoryExport({
    resolveAccessFn: async () => ({ companyId: 7, access: { scoped: false }, scope: { sql: '', params: [] } }),
    extractContextFn: () => ({ uid: 'u1', companyId: 7, sqlStaffId: 3 }),
    enqueueFn: async (type, payload, opts) => {
      enqueued = { type, payload, opts };
      return { id: 'job-9' };
    },
  });

  await handler({ body: { filters: { brand: 'Dell' }, search: '00100' } }, res);

  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.payload, { ok: true, msg: 'Inventory export queued', jobId: 'job-9' });
  assert.equal(enqueued.type, 'inventory:export');
  assert.deepEqual(enqueued.payload.filters, { brand: 'Dell' });
  assert.equal(enqueued.payload.search, '00100');
  // El dueño del job es quien podrá hacer polling de /jobs/owned/:jobId.
  assert.equal(enqueued.opts.context.uid, 'u1');
});

test('un filtro inválido da 400 al encolar, no un job fallido', async () => {
  const res = mockRes();
  let called = false;

  const handler = createPostInventoryExport({
    resolveAccessFn: async () => ({ companyId: 7, access: { scoped: false }, scope: { sql: '', params: [] } }),
    extractContextFn: () => ({ uid: 'u1' }),
    enqueueFn: async () => { called = true; return { id: 'x' }; },
  });

  await handler({ body: { sortBy: 'cost' } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.msg, /sortBy must be one of/);
  assert.equal(called, false, 'no se encola un job que va a fallar seguro');
});

test('sin uid no se encola: el job sería inalcanzable por su dueño', async () => {
  const res = mockRes();
  const handler = createPostInventoryExport({
    resolveAccessFn: async () => ({ companyId: 7, access: { scoped: false }, scope: { sql: '', params: [] } }),
    extractContextFn: () => ({ uid: null }),
    enqueueFn: async () => { throw new Error('no debería encolar'); },
  });

  await handler({ body: {} }, res);

  assert.equal(res.statusCode, 401);
});

test('el Idempotency-Key va namespaced por tipo de job', async () => {
  const res = mockRes();
  let opts = null;

  const handler = createPostInventoryExport({
    resolveAccessFn: async () => ({ companyId: 7, access: { scoped: false }, scope: { sql: '', params: [] } }),
    extractContextFn: () => ({ uid: 'u1' }),
    enqueueFn: async (_type, _payload, o) => { opts = o; return { id: 'job-9' }; },
  });

  await handler({ body: {}, get: (name) => (name === 'Idempotency-Key' ? ' abc ' : undefined) }, res);

  assert.equal(opts.idempotencyKey, 'inventory:export:abc');
});

test('si resolveAccess ya respondió, el controller no encola', async () => {
  const res = mockRes();
  const handler = createPostInventoryExport({
    // null = resolveAccess ya envió su propio 400/403.
    resolveAccessFn: async () => null,
    extractContextFn: () => ({ uid: 'u1' }),
    enqueueFn: async () => { throw new Error('no debería encolar'); },
  });

  await handler({ body: {} }, res);

  assert.equal(res.payload, null);
});
