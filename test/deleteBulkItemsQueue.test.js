'use strict';

/**
 * POST /api/db_item/delete-bulk-items migrado a la cola
 * (`inventory:bulk-delete-by-ids`), gemelo de delete-bulk-items-criteria.
 *
 * Lo que fijan estos tests:
 * - La autorización y el filtrado por scope NO se van al job: dependen de
 *   `request.sqlStaffId` y se resuelven en el request. El job recibe los ids ya
 *   filtrados.
 * - El troceo que el DELETE del lado Go no hace.
 * - La clave de idempotencia derivada del contenido (mismo set de ids en otro
 *   orden = misma clave), para que el reintento del cliente no encole dos veces.
 * - `result.affectedRows` ahora trae el conteo real: antes era `workerResponse.data`
 *   sobre un valor que `runGoWorker` ya devolvía desempaquetado, o sea `undefined`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDeleteBulkItems } = require('../mysql/controllers/item');
const { createDeleteBulkItemsByIdsHandler } = require('../queue/handlers/deleteBulkItemsByIds');

// ─── Dobles ──────────────────────────────────────────────────────────────────

const makeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const makeReq = (body, { headers = {}, sqlStaffId = 77 } = {}) => ({
  body,
  sqlStaffId,
  ip: '10.0.0.1',
  headers,
  get: (name) => headers[String(name).toLowerCase()],
});

const fullAccess = { company_staff_id: 1, role_level: 2, scoped: false };
const scopedAccess = { company_staff_id: 1, role_level: 8, scoped: true };

// Controlador armado con todo inyectado: nada toca MySQL, Mongo ni el Go worker.
const build = ({
  access = fullAccess,
  writable = { dimension: 'location', values: [] },
  rows = [],
  outcome = { outcome: 'done', result: { deletedCount: 3, batches: 1 } },
  jobId = 'JOB-1',
} = {}) => {
  const enqueued = [];
  const controller = createDeleteBulkItems({
    getStaffCompanyAccessFn: async () => access,
    getWritableScopeFn: async () => writable,
    connectionFn: () => ({ execute: async () => [rows] }),
    enqueueFn: async (type, payload, opts) => {
      enqueued.push({ type, payload, opts });
      return { id: jobId };
    },
    extractContextFn: () => ({ uid: 'U1', sqlStaffId: 77 }),
    waitForJobOutcomeFn: async () => outcome,
  });
  return { controller, enqueued };
};

// ─── Contrato del controlador ────────────────────────────────────────────────

test('rol full-access: encola los ids del body y responde el conteo real del job', async () => {
  const { controller, enqueued } = build();
  const res = makeRes();

  await controller(makeReq({ company_id: 'C1', item_ids: [10, 11, 12] }), res);

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].type, 'inventory:bulk-delete-by-ids');
  assert.deepEqual(enqueued[0].payload, { company_id: 'C1', item_ids: [10, 11, 12] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, result: { affectedRows: 3 } });
});

test('el conteo ya no llega undefined (era workerResponse.data sobre el data desempaquetado)', async () => {
  const { controller } = build({ outcome: { outcome: 'done', result: { deletedCount: 412 } } });
  const res = makeRes();
  await controller(makeReq({ company_id: 'C1', item_ids: [1] }), res);
  assert.equal(res.body.result.affectedRows, 412);
});

test('rol con scope: el job recibe SOLO los ids permitidos, y skipped_count sale en la respuesta', async () => {
  const { controller, enqueued } = build({
    access: scopedAccess,
    writable: { dimension: 'location', values: [5] },
    rows: [
      { item_id: 10, location_id: 5, category_name: 'A' },
      { item_id: 11, location_id: 9, category_name: 'A' },
      { item_id: 12, location_id: 5, category_name: 'A' },
    ],
  });
  const res = makeRes();

  await controller(makeReq({ company_id: 'C1', item_ids: [10, 11, 12] }), res);

  assert.deepEqual(enqueued[0].payload.item_ids, [10, 12], 'el id fuera de scope no debe llegar al job');
  assert.equal(res.body.skipped_count, 1);
});

test('rol con scope sin nada permitido: no encola nada', async () => {
  const { controller, enqueued } = build({
    access: scopedAccess,
    writable: { dimension: 'location', values: [99] },
    rows: [{ item_id: 10, location_id: 5, category_name: 'A' }],
  });
  const res = makeRes();

  await controller(makeReq({ company_id: 'C1', item_ids: [10] }), res);

  assert.equal(enqueued.length, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.deleted_count, 0);
  assert.equal(res.body.skipped_count, 1);
});

test('sin sesión no hay staff access: 403 y no se encola (es el caso de la ruta anónima)', async () => {
  const { controller, enqueued } = build({ access: null });
  const res = makeRes();

  await controller(makeReq({ company_id: 'C1', item_ids: [10] }, { sqlStaffId: undefined }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(enqueued.length, 0);
});

test('validación: item_ids vacío y company_id ausente dan 400 antes de encolar', async () => {
  for (const body of [{ company_id: 'C1', item_ids: [] }, { item_ids: [1] }]) {
    const { controller, enqueued } = build();
    const res = makeRes();
    await controller(makeReq(body), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(enqueued.length, 0);
  }
});

// ─── Idempotencia ────────────────────────────────────────────────────────────

test('Idempotency-Key del cliente se usa namespaced por tipo', async () => {
  const { controller, enqueued } = build();
  const res = makeRes();

  await controller(
    makeReq({ company_id: 'C1', item_ids: [1, 2] }, { headers: { 'idempotency-key': ' abc-123 ' } }),
    res
  );

  assert.equal(enqueued[0].opts.idempotencyKey, 'inventory:bulk-delete-by-ids:abc-123');
});

test('sin header, la clave se deriva del contenido y no depende del orden de los ids', async () => {
  const a = build();
  const b = build();
  const resA = makeRes();
  const resB = makeRes();

  await a.controller(makeReq({ company_id: 'C1', item_ids: [3, 1, 2] }), resA);
  await b.controller(makeReq({ company_id: 'C1', item_ids: [2, 3, 1] }), resB);

  const keyA = a.enqueued[0].opts.idempotencyKey;
  assert.match(keyA, /^inventory:bulk-delete-by-ids:C1:[0-9a-f]{64}$/);
  assert.equal(keyA, b.enqueued[0].opts.idempotencyKey);
});

test('otra company con los mismos ids produce otra clave', async () => {
  const a = build();
  const b = build();
  await a.controller(makeReq({ company_id: 'C1', item_ids: [1] }), makeRes());
  await b.controller(makeReq({ company_id: 'C2', item_ids: [1] }), makeRes());
  assert.notEqual(a.enqueued[0].opts.idempotencyKey, b.enqueued[0].opts.idempotencyKey);
});

// ─── Los dos caminos que no son el feliz ─────────────────────────────────────

test('si el job no termina a tiempo: 202 con jobId polleable (la ruta tiene sesión)', async () => {
  const { controller } = build({ outcome: { outcome: 'timeout', job: {} }, jobId: 'JOB-XYZ' });
  const res = makeRes();

  await controller(makeReq({ company_id: 'C1', item_ids: [1] }), res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.jobId, 'JOB-XYZ');
  assert.match(res.body.msg, /jobs\/owned/);
});

test('si el job falla: 500 con el error del job', async () => {
  const { controller } = build({
    outcome: { outcome: 'failed', job: { lastError: 'Go Worker Connection Failed' } },
  });
  const res = makeRes();

  await controller(makeReq({ company_id: 'C1', item_ids: [1] }), res);

  assert.equal(res.statusCode, 500);
  assert.match(res.body.msg, /Go Worker Connection Failed/);
});

// ─── El handler: el troceo que faltaba ───────────────────────────────────────

test('handler: trocea los ids en lotes y suma las filas afectadas', async () => {
  const calls = [];
  const handler = createDeleteBulkItemsByIdsHandler({
    runGoWorker: async (command, args) => {
      calls.push({ command, count: args.item_ids.length });
      return { affectedRows: args.item_ids.length };
    },
    batchSize: 500,
  });

  const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
  const result = await handler({ company_id: 'C1', item_ids: ids });

  assert.deepEqual(calls.map((c) => c.count), [500, 500, 200]);
  assert.equal(calls[0].command, 'delete-bulk-items');
  assert.deepEqual(result, { deletedCount: 1200, batches: 3 });
});

test('handler: lista vacía no llama al Go worker', async () => {
  let called = 0;
  const handler = createDeleteBulkItemsByIdsHandler({
    runGoWorker: async () => { called += 1; return { affectedRows: 0 }; },
  });
  assert.deepEqual(await handler({ company_id: 'C1', item_ids: [] }), { deletedCount: 0, batches: 0 });
  assert.equal(called, 0);
});

test('handler: sin company_id lanza (el job va a reintento, no borra media cosa)', async () => {
  const handler = createDeleteBulkItemsByIdsHandler({ runGoWorker: async () => ({ affectedRows: 1 }) });
  await assert.rejects(() => handler({ item_ids: [1] }), /company_id is required/);
});

test('handler: un error del worker se propaga para que el job reintente', async () => {
  const handler = createDeleteBulkItemsByIdsHandler({
    runGoWorker: async () => { throw new Error('Go Worker Connection Failed'); },
  });
  await assert.rejects(
    () => handler({ company_id: 'C1', item_ids: [1] }),
    /Go Worker Connection Failed/
  );
});

test('handler: tolera que el worker no devuelva affectedRows', async () => {
  const handler = createDeleteBulkItemsByIdsHandler({ runGoWorker: async () => undefined });
  assert.deepEqual(await handler({ company_id: 'C1', item_ids: [1] }), { deletedCount: 0, batches: 1 });
});

// ─── La gemela de company.js ────────────────────────────────────────────────
// Iba montada sin ningún middleware mientras el controller exigía
// `request.sqlStaffId` (que solo setea validateJWT), así que respondía 403
// "Staff record not found for this company" a toda llamada del cliente desde
// el 2026-07-20. Ahora lleva la misma cadena que su gemela de item.js.

test('mysql/routes/company.js POST /delete-bulk-items: lleva la misma cadena de auth que su gemela', () => {
  const { validateJWT } = require('../middlewares/validate-jwt');
  const { checkTokenVersion } = require('../middlewares/checkValidateToken');

  const chainOf = (router, path) => {
    const layer = router.stack.find(
      (l) => l.route && l.route.path === path && l.route.methods.post
    );
    assert.ok(layer, `la ruta POST ${path} debe estar montada`);
    return layer.route.stack.map((l) => l.handle);
  };

  const companyChain = chainOf(require('../mysql/routes/company'), '/delete-bulk-items');
  const itemChain = chainOf(require('../mysql/routes/item'), '/delete-bulk-items');

  assert.ok(companyChain.includes(validateJWT), 'sin validateJWT no hay sqlStaffId → 403 garantizado');
  assert.ok(companyChain.includes(checkTokenVersion));
  assert.equal(
    companyChain.length,
    itemChain.length,
    'las dos rutas apuntan al mismo controller: deben exigir lo mismo'
  );
  // authorizePermission se identifica por su firma textual, como en
  // routeSecurityHardening.test.js (la factory devuelve funciones anónimas).
  assert.ok(
    companyChain.some((h) => h.toString().includes('insufficient permissions')),
    'debe llevar authorizePermission'
  );
});

test('el controlador real sigue cortando en 403 si llega sin sqlStaffId, sin encolar nada', async () => {
  const companyRouter = require('../mysql/routes/company');
  const layer = companyRouter.stack.find(
    (l) => l.route && l.route.path === '/delete-bulk-items' && l.route.methods.post
  );
  const controller = layer.route.stack.at(-1).handle;

  const res = makeRes();
  await controller(
    { body: { company_id: 137, item_ids: [1, 2] }, headers: {}, get: () => undefined },
    res
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
});

// ─── El tipo tiene que caer en el worker de borrados ─────────────────────────

test('el tipo nuevo pertenece al grupo delete (lo toma DevitrakDeleteWorker)', () => {
  const { GROUPS, DELETE_TYPES } = require('../constants/queueTypeGroups');
  assert.ok(DELETE_TYPES.includes('inventory:bulk-delete-by-ids'));
  assert.ok([...GROUPS.delete].includes('inventory:bulk-delete-by-ids'));
  assert.ok(!GROUPS.bulk.includes('inventory:bulk-delete-by-ids'), 'no debe competir con los inserts');
});
