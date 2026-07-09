'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Controller genérico que reemplaza el patrón repetido "armar msg + sgMail.send
// + responder" por "armar msg + enqueue + responder 202". enqueue/extractContext
// se inyectan (mismo patrón de mockRes que idempotencyMutationCache.test.js /
// paymentsRouteSmoke.test.js) para no tocar Mongo real en el test.
const { createQueuedEmailController } = require('../nodeMailer/queueEmail');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

test('createQueuedEmailController: compone el mensaje con buildMessage y lo encola como send-email', async () => {
  const calls = [];
  const fakeEnqueue = async (type, payload, opts) => {
    calls.push({ type, payload, opts });
    return { id: 'JOB1' };
  };
  const buildMessage = (body) => ({ to: body.consumer, from: 'noreply@devitrak.com', subject: body.subject, html: '<p>hi</p>' });

  const controller = createQueuedEmailController(buildMessage, {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });

  const req = { body: { consumer: 'a@b.com', subject: 'Hola' } };
  const res = mockRes();
  await controller(req, res);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'send-email');
  assert.deepEqual(calls[0].payload, { to: 'a@b.com', from: 'noreply@devitrak.com', subject: 'Hola', html: '<p>hi</p>' });
});

test('createQueuedEmailController: responde 202 con ok:true y el jobId del encolado', async () => {
  const fakeEnqueue = async () => ({ id: 'JOB-42' });
  const controller = createQueuedEmailController(() => ({}), {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.jobId, 'JOB-42');
});

test('createQueuedEmailController: adjunta el context extraído del request al enqueue', async () => {
  let capturedOpts;
  const fakeEnqueue = async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; };
  const fakeContext = { uid: 'U1', companyId: 'C1', sqlStaffId: 7 };

  const controller = createQueuedEmailController(() => ({}), {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => fakeContext,
  });

  await controller({ body: {} }, mockRes());
  assert.deepEqual(capturedOpts.context, fakeContext);
});

test('createQueuedEmailController: aplica idempotencyKeyFn cuando se provee', async () => {
  let capturedOpts;
  const fakeEnqueue = async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; };

  const controller = createQueuedEmailController(() => ({}), {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
    idempotencyKeyFn: (body) => `invoice:${body.transactionId}`,
  });

  await controller({ body: { transactionId: 'T1' } }, mockRes());
  assert.equal(capturedOpts.idempotencyKey, 'invoice:T1');
});

test('createQueuedEmailController: sin idempotencyKeyFn, no manda idempotencyKey (acepta duplicados)', async () => {
  let capturedOpts;
  const fakeEnqueue = async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; };

  const controller = createQueuedEmailController(() => ({}), {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });

  await controller({ body: {} }, mockRes());
  assert.equal(capturedOpts.idempotencyKey, undefined);
});

test('createQueuedEmailController: si enqueue falla, responde 500 sin lanzar', async () => {
  const fakeEnqueue = async () => { throw new Error('Mongo down'); };
  const controller = createQueuedEmailController(() => ({}), {
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
});

// ─── Builders puros de mensaje (composición de template, sin red ni DB) ──────
// Se migran de inline-en-el-controller a funciones nombradas y exportadas para
// poder testear la composición del mensaje sin tocar SendGrid.

const {
  buildSingleEmailMessage,
  buildNewUserInvitationMessage,
  buildInternalNotificationMessage,
  buildEventBeginsReminderMessage,
} = require('../nodeMailer/notifications');

test('buildSingleEmailMessage: usa body.consumer como destinatario y arma el subject', () => {
  const msg = buildSingleEmailMessage({ consumer: 'a@b.com', subject: 'Aviso', company: 'Devitrak', eventSelected: 'Evento X' });
  assert.equal(msg.to, 'a@b.com');
  assert.equal(msg.subject, 'Devitrak Notification - Aviso');
  assert.equal(typeof msg.html, 'string');
  assert.ok(msg.html.includes('related to the event Evento X'));
});

test('buildSingleEmailMessage: sin eventSelected no revienta y usa el fallback "."', () => {
  const msg = buildSingleEmailMessage({ consumer: 'a@b.com', subject: 'Aviso', company: 'Devitrak' });
  assert.equal(typeof msg.html, 'string');
  assert.ok(msg.html.includes('This email was sent from Devitrak.'));
  assert.ok(!msg.html.includes('related to the event'));
});

test('buildNewUserInvitationMessage: usa body.consumer como destinatario', () => {
  const msg = buildNewUserInvitationMessage({ consumer: 'nuevo@b.com', subject: 'Bienvenida' });
  assert.equal(msg.to, 'nuevo@b.com');
  assert.equal(msg.subject, 'Devitrak Notification - Bienvenida');
});

test('buildInternalNotificationMessage: usa body.staff como destinatario (no consumer)', () => {
  const msg = buildInternalNotificationMessage({ staff: 'staff@b.com', subject: 'Interno' });
  assert.equal(msg.to, 'staff@b.com');
});

test('buildEventBeginsReminderMessage: usa body.staff como destinatario', () => {
  const msg = buildEventBeginsReminderMessage({ staff: 'staff@b.com', subject: 'Recordatorio' });
  assert.equal(msg.to, 'staff@b.com');
});
