'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncOrQueuedController } = require('../helpers/queuedController');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

// Returns a fake Job "model" whose findById(...).lean() replays `statuses`
// in order, one per poll, then repeats the last one if polled more times
// than statuses provided (guards against infinite-loop tests).
function fakeJobModel(statuses) {
  let i = 0;
  return {
    findById: () => ({
      lean: async () => statuses[Math.min(i++, statuses.length - 1)],
    }),
  };
}

const noSleep = async () => {};
const baseOpts = (overrides = {}) => ({
  enqueueFn: async () => ({ id: 'JOB-1' }),
  extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  sleepFn: noSleep,
  ...overrides,
});

test('createSyncOrQueuedController: responde con el status/body sincrono si el job termina antes del timeout', async () => {
  const JobModel = fakeJobModel([
    { status: 'pending' },
    { status: 'done', result: { inserted: 42 } },
  ]);
  const controller = createSyncOrQueuedController('bulk:test', (body) => body, {
    ...baseOpts(),
    JobModel,
    buildSyncBody: (result) => ({ ok: true, ...result }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, inserted: 42 });
});

test('createSyncOrQueuedController: usa syncStatus personalizado', async () => {
  const JobModel = fakeJobModel([{ status: 'done', result: { created: 1 } }]);
  const controller = createSyncOrQueuedController('bulk:test', (body) => body, {
    ...baseOpts(),
    JobModel,
    syncStatus: 201,
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 201);
});

test('createSyncOrQueuedController: responde failedStatus/buildFailedBody si el job falla dentro de la espera', async () => {
  const JobModel = fakeJobModel([{ status: 'failed', lastError: 'constraint violation' }]);
  const controller = createSyncOrQueuedController('bulk:test', (body) => body, {
    ...baseOpts(),
    JobModel,
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, { ok: false, msg: 'constraint violation' });
});

test('createSyncOrQueuedController: trata "dead" igual que "failed"', async () => {
  const JobModel = fakeJobModel([{ status: 'dead', lastError: 'max attempts exceeded' }]);
  const controller = createSyncOrQueuedController('bulk:test', (body) => body, {
    ...baseOpts(),
    JobModel,
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.msg, 'max attempts exceeded');
});

test('createSyncOrQueuedController: si el job no termina antes de maxWaitMs, cae al fallback 202 + jobId', async () => {
  // Every poll comes back "processing" -- never resolves within the window.
  const JobModel = fakeJobModel([{ status: 'processing' }]);
  let now = 0;
  const controller = createSyncOrQueuedController('bulk:test', (body) => body, {
    ...baseOpts({ enqueueFn: async () => ({ id: 'JOB-BIG' }) }),
    JobModel,
    maxWaitMs: 1000,
    pollIntervalMs: 100,
    sleepFn: async () => { now += 100; },
    nowFn: () => now,
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.jobId, 'JOB-BIG');
  assert.match(res.payload.msg, /jobs\/owned/);
});

test('createSyncOrQueuedController: con validate que rechaza, responde su status/body y NO encola', async () => {
  const calls = [];
  const controller = createSyncOrQueuedController('bulk:test', (body) => body, {
    ...baseOpts({ enqueueFn: async (...args) => { calls.push(args); return { id: 'JOB-1' }; } }),
    validate: (body) => (body.company_id ? null : { status: 400, body: { ok: false, msg: 'company_id is required' } }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(calls.length, 0);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { ok: false, msg: 'company_id is required' });
});

test('createSyncOrQueuedController: si enqueue falla, responde 500 sin lanzar', async () => {
  const controller = createSyncOrQueuedController('bulk:test', (body) => body, {
    ...baseOpts({ enqueueFn: async () => { throw new Error('Mongo down'); } }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
});

test('createSyncOrQueuedController: adjunta context e idempotencyKey al enqueue, igual que createQueuedJobController', async () => {
  let capturedOpts;
  const fakeContext = { uid: 'U1', companyId: 'C1', sqlStaffId: 7 };
  const JobModel = fakeJobModel([{ status: 'done', result: {} }]);

  const controller = createSyncOrQueuedController('bulk:test', (body) => body, {
    ...baseOpts({
      enqueueFn: async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB-1' }; },
      extractContextFn: () => fakeContext,
    }),
    JobModel,
    idempotencyKeyFn: (body) => `bulk:${body.company_id}`,
  });

  await controller({ body: { company_id: 137 } }, mockRes());

  assert.deepEqual(capturedOpts.context, fakeContext);
  assert.equal(capturedOpts.idempotencyKey, 'bulk:137');
});
