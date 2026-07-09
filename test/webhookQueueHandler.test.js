'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Handler genérico de la cola para disparar un webhook HTTP externo (ej. el
// disparo de importación de inventario en uploadExcelToS3). fetchImpl se
// inyecta para testear sin red real. Ver DESIGN_task_queue.md § Fase 2.
const { createWebhookHandler } = require('../queue/handlers/webhook');

function fakeResponse({ ok = true, status = 200, statusText = 'OK', text = '' } = {}) {
  return { ok, status, statusText, text: async () => text };
}

test('createWebhookHandler: hace POST a la url con el body en JSON', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return fakeResponse(); };
  const handler = createWebhookHandler(fetchImpl);

  await handler({ url: 'https://example.com/hook', body: { a: 1 } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/hook');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].opts.body, JSON.stringify({ a: 1 }));
});

test('createWebhookHandler: en respuesta ok, devuelve el status', async () => {
  const handler = createWebhookHandler(async () => fakeResponse({ status: 201 }));
  const result = await handler({ url: 'https://example.com/hook', body: {} });
  assert.equal(result.status, 201);
});

test('createWebhookHandler: en respuesta no-ok, lanza (para que el worker reintente)', async () => {
  const handler = createWebhookHandler(async () => fakeResponse({ ok: false, status: 502, text: 'down' }));
  await assert.rejects(() => handler({ url: 'https://example.com/hook', body: {} }), /502/);
});
