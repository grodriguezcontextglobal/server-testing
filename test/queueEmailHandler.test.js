'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Handler genérico de la cola para 'send-email'. Recibe la función de envío por
// inyección de dependencia (igual que el resto del repo mockea con objetos
// planos, sin librerías de mocking) para poder testear sin tocar SendGrid real.
const { createEmailHandler } = require('../queue/handlers/email');

test('createEmailHandler: envía el payload tal cual mediante sendFn', async () => {
  const calls = [];
  const sendFn = async (msg) => { calls.push(msg); return [{ statusCode: 202 }]; };
  const handler = createEmailHandler(sendFn);

  const msg = { to: 'a@b.com', from: 'noreply@devitrak.com', subject: 'Hi', html: '<p>hi</p>' };
  const result = await handler(msg);

  assert.deepEqual(calls, [msg]);
  assert.deepEqual(result, [{ statusCode: 202 }]);
});

test('createEmailHandler: propaga el error de sendFn (para que el worker reintente)', async () => {
  const sendFn = async () => { throw new Error('SendGrid 503'); };
  const handler = createEmailHandler(sendFn);

  await assert.rejects(() => handler({ to: 'a@b.com' }), /SendGrid 503/);
});
