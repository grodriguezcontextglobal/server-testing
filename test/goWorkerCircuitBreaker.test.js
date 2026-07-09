'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// helpers/goWorker.js ya tenía reintento (3 intentos, backoff exponencial) —
// eso protege UNA llamada. Lo que faltaba es un circuit breaker que proteja
// entre llamadas: si el Go worker está caído, que las siguientes requests
// fallen rápido en vez de esperar los 3 reintentos completos cada vez.
// createRunGoWorker(fetchImpl) permite testear sin red real; el export por
// defecto (module.exports) sigue siendo la función lista para usar, para no
// tocar ninguno de los ~8 call-sites existentes (`const runGoWorker =
// require("../helpers/goWorker")`). Ver DESIGN_task_queue.md § Fase 2.
const runGoWorkerModule = require('../helpers/goWorker');
const { createRunGoWorker } = runGoWorkerModule;

function fakeResponse({ ok = true, status = 200, statusText = 'OK', data = {}, errorStatus } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => (errorStatus ? { status: 'error', message: 'boom' } : { status: 'ok', data }),
    text: async () => 'server error body',
  };
}

test('createRunGoWorker: en éxito, devuelve result.data sin reintentar', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return fakeResponse({ data: { hello: 'world' } }); };
  const runGoWorker = createRunGoWorker(fetchImpl);

  const result = await runGoWorker('some-command', { a: 1 });

  assert.deepEqual(result, { hello: 'world' });
  assert.equal(calls, 1);
});

test('createRunGoWorker: reintenta hasta 3 veces antes de fallar (comportamiento preexistente)', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('ECONNREFUSED'); };
  const runGoWorker = createRunGoWorker(fetchImpl, { failureThreshold: 100 }); // breaker no interfiere en este test

  await assert.rejects(() => runGoWorker('cmd', {}, 3), /Go Worker Connection Failed after 3 attempts/);
  assert.equal(calls, 3);
});

test('createRunGoWorker: tras failureThreshold llamadas fallidas seguidas, el circuito se abre y falla rápido', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('ECONNREFUSED'); };
  // failureThreshold=1 sobre el runGoWorker COMPLETO (no cada intento interno);
  // usamos retries=1 por llamada para que cada runGoWorker() cuente como un solo fallo del breaker.
  const runGoWorker = createRunGoWorker(fetchImpl, { failureThreshold: 1, cooldownMs: 30000 });

  await assert.rejects(() => runGoWorker('cmd', {}, 1));
  const callsAfterFirstFailure = calls;

  await assert.rejects(() => runGoWorker('cmd', {}, 1), /Circuit breaker is open/);
  // El breaker abierto no debe haber intentado llamar a fetch de nuevo.
  assert.equal(calls, callsAfterFirstFailure);
});

test('createRunGoWorker: el export por defecto sigue siendo una función invocable directamente (compatibilidad con call-sites existentes)', () => {
  assert.equal(typeof runGoWorkerModule, 'function');
});
