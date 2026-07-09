'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// loginActivityNotification es una función INTERNA (no HTTP), invocada dentro
// de un setImmediate desde controller/admin.js — ya es fire-and-forget respecto
// a la respuesta de login. Nunca lanzaba y devolvía {success, message}; se migra
// a enqueue('send-email', ...) preservando ese mismo contrato. Mismo patrón que
// logStaffActivity (ver DESIGN_task_queue.md § Fase 1).
const { loginActivityNotification, buildLoginActivityMessage } = require('../nodeMailer/notifications');

test('buildLoginActivityMessage: sanitiza name/lastName/company/role y arma el mensaje', () => {
  const adminUser = { name: 'A<script>', lastName: 'B>', email: ' a@b.com ', company: 'X<>', role: 'Y<>' };
  const msg = buildLoginActivityMessage(adminUser, { ip: '1.2.3.4' });
  assert.equal(msg.to, 'a@b.com');
  assert.equal(msg.bcc, 'grodriguez@devitrak.com');
  assert.match(msg.subject, /Login Activity Alert/);
  assert.equal(typeof msg.html, 'string');
});

test('loginActivityNotification: encola type send-email con el mensaje armado', async () => {
  const calls = [];
  const fakeEnqueue = async (type, payload) => { calls.push({ type, payload }); return { id: 'JOB1' }; };

  const result = await loginActivityNotification(
    { name: 'A', lastName: 'B', email: 'a@b.com' },
    { ip: '1.2.3.4' },
    { enqueueFn: fakeEnqueue },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'send-email');
  assert.equal(calls[0].payload.to, 'a@b.com');
  assert.equal(result.success, true);
  assert.equal(result.jobId, 'JOB1');
});

test('loginActivityNotification: nunca lanza, incluso si enqueue falla (preserva el contrato actual)', async () => {
  const fakeEnqueue = async () => { throw new Error('Mongo down'); };
  const result = await loginActivityNotification({ name: 'A', email: 'a@b.com' }, { ip: '1' }, { enqueueFn: fakeEnqueue });

  assert.equal(result.success, false);
  assert.match(result.message, /Failed/);
});

test('loginActivityNotification: nunca lanza si falta adminUser.email (preserva el contrato actual)', async () => {
  const fakeEnqueue = async () => { throw new Error('no debería llamarse'); };
  const result = await loginActivityNotification(null, { ip: '1' }, { enqueueFn: fakeEnqueue });

  assert.equal(result.success, false);
});

test('loginActivityNotification: sin opts, usa el enqueue real por defecto (compatibilidad hacia atrás)', () => {
  assert.equal(loginActivityNotification.length, 2);
});
