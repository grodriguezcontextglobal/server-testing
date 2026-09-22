'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Regresión: si el connect() inicial fallaba, el singleton `client` quedaba
// asignado (truthy) igual, así que la SIGUIENTE llamada reintentaba
// connect() sobre esa misma instancia rota en vez de crear una nueva — eso
// es lo que colgaba el login 30s en vez de fallar rápido (ver
// task_circuit_breaker_go_worker / investigación 2026-08-05 de
// /api/admin/login). El fix: no promover `client` hasta que connect()
// resuelva con éxito.

function makeFakeClient({ connectShouldFail = false, isOpen = false } = {}) {
  const listeners = {};
  return {
    isOpen,
    connectCalls: 0,
    on(event, cb) { listeners[event] = cb; return this; },
    async connect() {
      this.connectCalls += 1;
      if (connectShouldFail) throw new Error('ECONNREFUSED (simulated)');
      this.isOpen = true;
    },
  };
}

test('clientRedis: si el connect() inicial falla, NO deja el singleton envenenado (la próxima llamada crea uno nuevo)', async () => {
  process.env.REDIS_HOST = 'fake-host';
  process.env.REDIS_PASSWORD = 'fake-pass';

  const { createClientRedis, __resetClientForTests } = require('../database/cacheMemoryConfig');
  __resetClientForTests();

  const brokenClient = makeFakeClient({ connectShouldFail: true });
  const workingClient = makeFakeClient({ connectShouldFail: false });
  const createClientFn = () => {
    // First call returns the broken client, second call returns a working one —
    // simulating "Redis was briefly unreachable, then recovered".
    return createClientFn.calls++ === 0 ? brokenClient : workingClient;
  };
  createClientFn.calls = 0;

  const clientRedis = createClientRedis({ createClientFn });

  // Attempt 1: fails, as before.
  await assert.rejects(() => clientRedis(), /ECONNREFUSED/);

  // Attempt 2: with the bug, this would call connect() again on `brokenClient`
  // (createClientFn would never be called a 2nd time). With the fix, a FRESH
  // client is created and connected successfully.
  const result = await clientRedis();

  assert.equal(createClientFn.calls, 2, 'createClientFn debe llamarse de nuevo (client no debe reusar la instancia rota)');
  assert.equal(brokenClient.connectCalls, 1, 'no se debe reintentar connect() sobre el cliente roto');
  assert.equal(result, workingClient);

  __resetClientForTests();
});

test('clientRedis: en éxito, promueve el cliente y lo reutiliza en llamadas siguientes (sin volver a conectar)', async () => {
  process.env.REDIS_HOST = 'fake-host';
  process.env.REDIS_PASSWORD = 'fake-pass';

  const { createClientRedis, __resetClientForTests } = require('../database/cacheMemoryConfig');
  __resetClientForTests();

  const workingClient = makeFakeClient({ connectShouldFail: false });
  const createClientFn = () => workingClient;
  const clientRedis = createClientRedis({ createClientFn });

  const first = await clientRedis();
  const second = await clientRedis();

  assert.equal(first, workingClient);
  assert.equal(second, workingClient);
  assert.equal(workingClient.connectCalls, 1, 'un cliente ya abierto no debe reconectar');

  __resetClientForTests();
});
