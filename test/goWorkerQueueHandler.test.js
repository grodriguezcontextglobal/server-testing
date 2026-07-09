'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Handler genérico para mutaciones del Go worker que son fire-and-forget (el
// cliente no necesita el resultado sincrónico — a diferencia de la mayoría de
// las mutaciones del Go worker, ver DESIGN_task_queue.md § Fase 2). Reusa
// runGoWorker (con su circuit breaker) inyectado, parametrizado por el
// comando.
const { createGoWorkerHandler } = require('../queue/handlers/goWorker');

test('createGoWorkerHandler: llama a runGoWorkerFn con el comando fijo y el payload del job', async () => {
  const calls = [];
  const fakeRunGoWorker = async (command, payload) => { calls.push({ command, payload }); return { inserted: 3 }; };
  const handler = createGoWorkerHandler(fakeRunGoWorker, 'insert-device-event-container');

  const result = await handler({ event_id: 'E1', refDatabase: {} });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'insert-device-event-container');
  assert.deepEqual(calls[0].payload, { event_id: 'E1', refDatabase: {} });
  assert.deepEqual(result, { inserted: 3 });
});

test('createGoWorkerHandler: propaga el error (para que el worker reintente / dead-letter)', async () => {
  const fakeRunGoWorker = async () => { throw new Error('Go worker down'); };
  const handler = createGoWorkerHandler(fakeRunGoWorker, 'insert-device-event-container');

  await assert.rejects(() => handler({}), /Go worker down/);
});
