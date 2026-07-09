'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Factory genérica: arma payload + enqueue + responde 202. Extraída de
// nodeMailer/queueEmail.js al aparecer un segundo consumidor real (los logs),
// siguiendo la misma regla que ya se aplicó al resto del repo: generalizar
// cuando hay 2+ usos concretos, no antes.
const { createQueuedJobController } = require('../helpers/queuedController');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

test('createQueuedJobController: arma el payload con buildPayload y lo encola con el type dado', async () => {
  const calls = [];
  const fakeEnqueue = async (type, payload, opts) => { calls.push({ type, payload, opts }); return { id: 'JOB1' }; };

  const controller = createQueuedJobController('log:event', (body) => ({ ...body, extra: 1 }), {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });

  await controller({ body: { user: 'U1' } }, mockRes());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'log:event');
  assert.deepEqual(calls[0].payload, { user: 'U1', extra: 1 });
});

test('createQueuedJobController: por defecto responde 202 { ok:true, jobId }', async () => {
  const fakeEnqueue = async () => ({ id: 'JOB-9' });
  const controller = createQueuedJobController('log:notification', (body) => body, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.payload, { ok: true, jobId: 'JOB-9' });
});

test('createQueuedJobController: buildSuccessBody permite personalizar la respuesta (ej. emails)', async () => {
  const fakeEnqueue = async () => ({ id: 'JOB-9' });
  const controller = createQueuedJobController('send-email', (body) => body, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
    buildSuccessBody: (job) => ({ ok: true, notification: 'Email queued', jobId: job.id }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.deepEqual(res.payload, { ok: true, notification: 'Email queued', jobId: 'JOB-9' });
});

test('createQueuedJobController: adjunta el context extraído del request', async () => {
  let capturedOpts;
  const fakeEnqueue = async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; };
  const fakeContext = { uid: 'U1', companyId: 'C1', sqlStaffId: 7 };

  const controller = createQueuedJobController('log:event', (body) => body, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => fakeContext,
  });

  await controller({ body: {} }, mockRes());
  assert.deepEqual(capturedOpts.context, fakeContext);
});

test('createQueuedJobController: aplica idempotencyKeyFn cuando se provee', async () => {
  let capturedOpts;
  const fakeEnqueue = async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; };

  const controller = createQueuedJobController('log:event', (body) => body, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
    idempotencyKeyFn: (body) => `entity:${body.id}`,
  });

  await controller({ body: { id: 'E1' } }, mockRes());
  assert.equal(capturedOpts.idempotencyKey, 'entity:E1');
});

test('createQueuedJobController: si enqueue falla, responde 500 sin lanzar', async () => {
  const fakeEnqueue = async () => { throw new Error('Mongo down'); };
  const controller = createQueuedJobController('log:event', (body) => body, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
});

test('createQueuedJobController: con validate que rechaza, responde con su status/body y NO encola', async () => {
  const calls = [];
  const fakeEnqueue = async (type, payload, opts) => { calls.push({ type, payload, opts }); return { id: 'JOB1' }; };

  const controller = createQueuedJobController('log:event', (body) => body, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
    validate: (body) => (body.email ? null : { status: 400, body: { ok: false, msg: 'email is required' } }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(calls.length, 0);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { ok: false, msg: 'email is required' });
});

test('createQueuedJobController: con validate que aprueba (devuelve null/undefined), sigue normal y encola', async () => {
  const calls = [];
  const fakeEnqueue = async (type, payload, opts) => { calls.push({ type, payload, opts }); return { id: 'JOB1' }; };

  const controller = createQueuedJobController('log:event', (body) => body, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
    validate: (body) => (body.email ? null : { status: 400, body: {} }),
  });

  const res = mockRes();
  await controller({ body: { email: 'a@b.com' } }, res);

  assert.equal(calls.length, 1);
  assert.equal(res.statusCode, 202);
});

test('createQueuedJobController: soporta buildPayload async (ej. arma mensajes múltiples)', async () => {
  const calls = [];
  const fakeEnqueue = async (type, payload, opts) => { calls.push({ type, payload, opts }); return { id: 'JOB1' }; };

  const controller = createQueuedJobController('send-email', async (body) => [{ to: body.a }, { to: body.b }], {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });

  await controller({ body: { a: 'a@b.com', b: 'c@d.com' } }, mockRes());

  assert.deepEqual(calls[0].payload, [{ to: 'a@b.com' }, { to: 'c@d.com' }]);
});

test('createQueuedJobController: buildPayload que resuelve null NO encola, responde con buildSkippedBody', async () => {
  const calls = [];
  const fakeEnqueue = async (type, payload, opts) => { calls.push({ type, payload, opts }); return { id: 'JOB1' }; };

  const controller = createQueuedJobController('send-email-multiple', async () => null, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
    buildSkippedBody: () => ({ ok: true, notification: 'No email sent to any consumers' }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(calls.length, 0);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, notification: 'No email sent to any consumers' });
});

test('createQueuedJobController: sin buildSkippedBody, payload null usa un default razonable', async () => {
  const fakeEnqueue = async () => { throw new Error('no debería llamarse'); };
  const controller = createQueuedJobController('log:event', async () => null, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
});

test('createQueuedJobController: si enqueue falla, deja rastro vía logger (no se pierde en silencio)', async () => {
  const fakeEnqueue = async () => { throw new Error('Mongo down'); };
  const logCalls = [];
  const fakeLogger = { error: (...args) => logCalls.push(args) };

  const controller = createQueuedJobController('log:event', (body) => body, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
    logger: fakeLogger,
  });

  await controller({ body: {} }, mockRes());

  assert.equal(logCalls.length, 1);
  assert.match(logCalls[0][0], /log:event/);
});
