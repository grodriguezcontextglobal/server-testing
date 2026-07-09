'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// createErrorFeed prometía en su respuesta un errorId "para referencia futura"
// que hoy es el _id real del documento guardado síncronamente. Al encolar,
// Mongoose permite pre-generar ese _id ANTES de persistir (se asigna en el
// cliente al construir el documento, no en el server de Mongo) — así que se
// puede responder con el id real de inmediato y encolar la persistencia
// reusando ese mismo id. Dos jobs independientes (log:error + send-email), cada
// uno idempotente por ese errorId. Ver DESIGN_task_queue.md § Fase 1 (cierre).
const { buildErrorFeedbackMessage } = require('../nodeMailer/notifications');
const { createCreateErrorFeed, validateErrorFeed } = require('../controller/errorLog');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

// ─── buildErrorFeedbackMessage: builder puro ─────────────────────────────────

test('buildErrorFeedbackMessage: arma el correo fijo a soporte con los datos del error', () => {
  const msg = buildErrorFeedbackMessage({ errorId: 'E1', error: 'boom', componentStack: 'at X' });
  assert.match(msg.to, /grodriguez@contextglobal.com/);
  assert.match(msg.subject, /Error Log/);
  assert.match(msg.html, /E1/);
  assert.match(msg.html, /boom/);
});

// ─── validateErrorFeed ────────────────────────────────────────────────────────

test('validateErrorFeed: rechaza sin componentStack', () => {
  assert.equal(validateErrorFeed({ error: 'boom' }).status, 400);
});

test('validateErrorFeed: rechaza sin error', () => {
  assert.equal(validateErrorFeed({ componentStack: 'at X' }).status, 400);
});

test('validateErrorFeed: aprueba con ambos campos', () => {
  assert.equal(validateErrorFeed({ componentStack: 'at X', error: 'boom' }), null);
});

// ─── createCreateErrorFeed (DI) ───────────────────────────────────────────────

test('createErrorFeed: pre-genera el id, encola log:error y send-email con el MISMO id, responde de inmediato', async () => {
  const calls = [];
  const fakeEnqueue = async (type, payload, opts) => { calls.push({ type, payload, opts }); return { id: 'JOB' }; };
  const controller = createCreateErrorFeed({
    enqueueFn: fakeEnqueue,
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
    generateId: () => 'PRE-GENERATED-ID',
  });

  const res = mockRes();
  await controller({ body: { componentStack: 'at X', error: 'boom' } }, res);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, 'log:error');
  assert.equal(calls[0].payload._id, 'PRE-GENERATED-ID');
  assert.equal(calls[0].opts.idempotencyKey, 'log:error:PRE-GENERATED-ID');
  assert.equal(calls[1].type, 'send-email');
  assert.equal(calls[1].opts.idempotencyKey, 'send-email:error-notification:PRE-GENERATED-ID');

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.errorId, 'PRE-GENERATED-ID');
  assert.match(res.payload.msg, /PRE-GENERATED-ID/);
});

test('createErrorFeed: 400 si falta componentStack/error, NO encola nada', async () => {
  const calls = [];
  const fakeEnqueue = async (...args) => { calls.push(args); return { id: 'JOB' }; };
  const controller = createCreateErrorFeed({ enqueueFn: fakeEnqueue, generateId: () => 'X' });

  const res = mockRes();
  await controller({ body: {} }, res);

  assert.equal(calls.length, 0);
  assert.equal(res.statusCode, 400);
});

test('createErrorFeed: 500 si el enqueue del log falla (no responde 200 con un id que no se va a guardar)', async () => {
  const fakeEnqueue = async () => { throw new Error('Mongo down'); };
  const controller = createCreateErrorFeed({ enqueueFn: fakeEnqueue, generateId: () => 'X' });

  const res = mockRes();
  await controller({ body: { componentStack: 'at X', error: 'boom' } }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
});

test('createErrorFeed: un fallo en el segundo enqueue (email) no debe impedir haber encolado ya el log', async () => {
  const calls = [];
  let count = 0;
  const fakeEnqueue = async (type, payload, opts) => {
    calls.push({ type, payload, opts });
    count += 1;
    if (count === 2) throw new Error('SendGrid enqueue failed');
    return { id: 'JOB' };
  };
  const controller = createCreateErrorFeed({ enqueueFn: fakeEnqueue, generateId: () => 'X' });

  const res = mockRes();
  await controller({ body: { componentStack: 'at X', error: 'boom' } }, res);

  // El log SÍ se encoló (primer call ya ocurrió) aunque la respuesta sea 500.
  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, 'log:error');
  assert.equal(res.statusCode, 500);
});
