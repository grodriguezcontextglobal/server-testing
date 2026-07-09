'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Endpoints de observabilidad de la cola: GET /api/jobs/:jobId (detalle) y
// GET /api/jobs/stats (conteo por status). Solo accesibles a super_user (ver
// middlewares/requireSuperUser.js + routes/jobs.js). Sigue el mismo patrón DI
// que el resto de la cola: la lectura a Mongo se inyecta para testear sin DB.
const {
  buildJobStatusResponse,
  buildStatsFromRows,
  createGetJobStatus,
  createGetJobStats,
  buildOwnedJobResponse,
  createGetOwnedJobStatus,
} = require('../controller/jobs');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

// ─── buildJobStatusResponse: formato de un job para el detalle ───────────────

test('buildJobStatusResponse: expone los campos relevantes para depurar un job', () => {
  const job = {
    id: 'J1', type: 'send-email', status: 'dead', payload: { to: 'a@b.com' },
    context: { uid: 'U1', companyId: 'C1', sqlStaffId: null },
    attempts: 5, maxAttempts: 5, lastError: 'SendGrid 503', result: null,
    nextAttemptAt: null, lockedBy: null, lockedAt: null, doneAt: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  };
  const body = buildJobStatusResponse(job);
  assert.equal(body.ok, true);
  assert.equal(body.id, 'J1');
  assert.equal(body.status, 'dead');
  assert.equal(body.attempts, 5);
  assert.equal(body.lastError, 'SendGrid 503');
  assert.deepEqual(body.payload, { to: 'a@b.com' });
  assert.deepEqual(body.context, { uid: 'U1', companyId: 'C1', sqlStaffId: null });
});

// ─── buildStatsFromRows: agregación pura, rellena ceros ──────────────────────

test('buildStatsFromRows: cuenta por status y agrega total', () => {
  const rows = [{ _id: 'pending', count: 3 }, { _id: 'done', count: 12 }];
  const stats = buildStatsFromRows(rows);
  assert.equal(stats.pending, 3);
  assert.equal(stats.done, 12);
  assert.equal(stats.total, 15);
});

test('buildStatsFromRows: statuses sin filas quedan en 0 (no se omiten)', () => {
  const stats = buildStatsFromRows([{ _id: 'dead', count: 1 }]);
  assert.equal(stats.pending, 0);
  assert.equal(stats.processing, 0);
  assert.equal(stats.done, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.dead, 1);
  assert.equal(stats.total, 1);
});

test('buildStatsFromRows: sin filas, todo en 0', () => {
  const stats = buildStatsFromRows([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.pending, 0);
});

// ─── createGetJobStatus: GET /api/jobs/:jobId ────────────────────────────────

test('createGetJobStatus: 400 si el jobId no tiene formato de ObjectId de Mongo', async () => {
  const controller = createGetJobStatus({ findById: async () => { throw new Error('no debería llamarse'); } });
  const res = mockRes();

  await controller({ params: { jobId: 'not-an-id' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
});

test('createGetJobStatus: 404 si el job no existe', async () => {
  const controller = createGetJobStatus({ findById: async () => null });
  const res = mockRes();

  await controller({ params: { jobId: '507f1f77bcf86cd799439011' } }, res);

  assert.equal(res.statusCode, 404);
});

test('createGetJobStatus: 200 con el detalle del job cuando existe', async () => {
  const job = { id: 'J1', type: 'log:event', status: 'done', payload: {}, context: {}, attempts: 1, maxAttempts: 5 };
  const controller = createGetJobStatus({ findById: async (id) => (id === '507f1f77bcf86cd799439011' ? job : null) });
  const res = mockRes();

  await controller({ params: { jobId: '507f1f77bcf86cd799439011' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.id, 'J1');
  assert.equal(res.payload.status, 'done');
});

test('createGetJobStatus: 500 si la consulta a Mongo falla', async () => {
  const controller = createGetJobStatus({ findById: async () => { throw new Error('Mongo down'); } });
  const res = mockRes();

  await controller({ params: { jobId: '507f1f77bcf86cd799439011' } }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
});

// ─── createGetJobStats: GET /api/jobs/stats ──────────────────────────────────

test('createGetJobStats: 200 con el conteo agregado por status', async () => {
  const controller = createGetJobStats({
    aggregateByStatus: async () => [{ _id: 'pending', count: 2 }, { _id: 'done', count: 8 }],
  });
  const res = mockRes();

  await controller({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.stats.pending, 2);
  assert.equal(res.payload.stats.done, 8);
  assert.equal(res.payload.stats.total, 10);
});

test('createGetJobStats: 500 si la agregación falla', async () => {
  const controller = createGetJobStats({ aggregateByStatus: async () => { throw new Error('Mongo down'); } });
  const res = mockRes();

  await controller({}, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
});

// ─── GET /api/jobs/owned/:jobId — polling del DUEÑO del job (no super_user) ──
// Endpoint aditivo: reutiliza validateJWT (ya integrado), NO toca requireSuperUser
// ni los endpoints del dashboard. Devuelve el job solo si context.uid === req.uid.
// Para no filtrar existencia, un job ajeno responde 404 (igual que not-found).
// Respuesta SLIM: no expone payload/context/lockedBy (el payload de un upload
// tiene rutas internas de archivo, etc.) — solo lo necesario para el polling.

test('buildOwnedJobResponse: expone solo status/result/attempts, NO payload ni context', () => {
  const job = {
    id: 'J1', type: 'document:upload-pdf', status: 'done',
    attempts: 1, lastError: null, result: { document: { id: 'DOC1' } },
    payload: { file: { path: '/tmp/secret.pdf' } },
    context: { uid: 'U1', companyId: 'C1', sqlStaffId: 7 },
    lockedBy: 'worker-1',
  };
  const body = buildOwnedJobResponse(job);
  assert.equal(body.ok, true);
  assert.equal(body.id, 'J1');
  assert.equal(body.status, 'done');
  assert.deepEqual(body.result, { document: { id: 'DOC1' } });
  assert.equal('payload' in body, false);
  assert.equal('context' in body, false);
  assert.equal('lockedBy' in body, false);
});

test('createGetOwnedJobStatus: 200 con el job cuando context.uid === req.uid', async () => {
  const job = { id: 'J1', type: 'document:upload-pdf', status: 'done', attempts: 1, result: { document: { id: 'DOC1' } }, context: { uid: 'U1' } };
  const controller = createGetOwnedJobStatus({ findById: async () => job });
  const res = mockRes();

  await controller({ uid: 'U1', params: { jobId: '507f1f77bcf86cd799439011' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.result, { document: { id: 'DOC1' } });
});

test('createGetOwnedJobStatus: 404 si el job es de OTRO usuario (no filtra existencia)', async () => {
  const job = { id: 'J1', status: 'done', context: { uid: 'OTHER' } };
  const controller = createGetOwnedJobStatus({ findById: async () => job });
  const res = mockRes();

  await controller({ uid: 'U1', params: { jobId: '507f1f77bcf86cd799439011' } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.ok, false);
});

test('createGetOwnedJobStatus: 404 si el job no tiene dueño (context.uid null)', async () => {
  const job = { id: 'J1', status: 'done', context: { uid: null } };
  const controller = createGetOwnedJobStatus({ findById: async () => job });
  const res = mockRes();

  await controller({ uid: 'U1', params: { jobId: '507f1f77bcf86cd799439011' } }, res);

  assert.equal(res.statusCode, 404);
});

test('createGetOwnedJobStatus: 404 si el job no existe', async () => {
  const controller = createGetOwnedJobStatus({ findById: async () => null });
  const res = mockRes();

  await controller({ uid: 'U1', params: { jobId: '507f1f77bcf86cd799439011' } }, res);

  assert.equal(res.statusCode, 404);
});

test('createGetOwnedJobStatus: 401 si no hay req.uid (token no validado)', async () => {
  const controller = createGetOwnedJobStatus({ findById: async () => { throw new Error('no debería llamarse'); } });
  const res = mockRes();

  await controller({ params: { jobId: '507f1f77bcf86cd799439011' } }, res);

  assert.equal(res.statusCode, 401);
});

test('createGetOwnedJobStatus: 400 si el jobId no es un ObjectId válido', async () => {
  const controller = createGetOwnedJobStatus({ findById: async () => { throw new Error('no debería llamarse'); } });
  const res = mockRes();

  await controller({ uid: 'U1', params: { jobId: 'not-an-id' } }, res);

  assert.equal(res.statusCode, 400);
});

test('createGetOwnedJobStatus: 500 si la consulta a Mongo falla', async () => {
  const controller = createGetOwnedJobStatus({ findById: async () => { throw new Error('Mongo down'); } });
  const res = mockRes();

  await controller({ uid: 'U1', params: { jobId: '507f1f77bcf86cd799439011' } }, res);

  assert.equal(res.statusCode, 500);
});
