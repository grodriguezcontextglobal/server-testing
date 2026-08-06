'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Regresión del outage de prod (2026-08-06): Node resolvía el Go worker en el
// puerto 7452 (heredado del .env) mientras el worker escuchaba en el 7453 que
// le inyectaba nssm. Cada llamada moría con ECONNREFUSED y el circuit breaker
// quedaba abierto, pero el error ("fetch failed", sin causa ni URL) no permitía
// verlo. Estos tests fijan las tres cosas que lo hicieron posible.

const runGoWorker = require('../helpers/goWorker');
const { resolveWorkerTarget, createRunGoWorker, DEFAULT_GO_WORKER_PORT } = runGoWorker;

test('resolveWorkerTarget: usa GO_WORKER_HOST/PORT cuando están seteados', () => {
  const prevHost = process.env.GO_WORKER_HOST;
  const prevPort = process.env.GO_WORKER_PORT;
  try {
    process.env.GO_WORKER_HOST = 'worker.internal';
    process.env.GO_WORKER_PORT = '9999';
    assert.deepEqual(resolveWorkerTarget(), { host: 'worker.internal', port: '9999' });
  } finally {
    if (prevHost === undefined) delete process.env.GO_WORKER_HOST; else process.env.GO_WORKER_HOST = prevHost;
    if (prevPort === undefined) delete process.env.GO_WORKER_PORT; else process.env.GO_WORKER_PORT = prevPort;
  }
});

test('resolveWorkerTarget: sin env vars, cae a localhost y al puerto default', () => {
  const prevHost = process.env.GO_WORKER_HOST;
  const prevPort = process.env.GO_WORKER_PORT;
  try {
    delete process.env.GO_WORKER_HOST;
    delete process.env.GO_WORKER_PORT;
    assert.deepEqual(resolveWorkerTarget(), { host: 'localhost', port: DEFAULT_GO_WORKER_PORT });
  } finally {
    if (prevHost === undefined) delete process.env.GO_WORKER_HOST; else process.env.GO_WORKER_HOST = prevHost;
    if (prevPort === undefined) delete process.env.GO_WORKER_PORT; else process.env.GO_WORKER_PORT = prevPort;
  }
});

// EL test que hubiera evitado el outage: los dos lados del contrato deben caer
// al MISMO puerto por default. Lee el default real del fuente Go, así que si
// alguien cambia uno de los dos, esto falla.
test('el default de puerto de Node y el del Go worker coinciden', () => {
  const mainGo = fs.readFileSync(path.resolve(__dirname, '../go-worker/main.go'), 'utf8');
  const match = mainGo.match(/port\s*=\s*"(\d+)"/);

  assert.ok(match, 'no se encontró el puerto default en go-worker/main.go');
  assert.equal(
    match[1],
    String(DEFAULT_GO_WORKER_PORT),
    `go-worker/main.go cae al puerto ${match[1]} pero helpers/goWorker.js cae al ${DEFAULT_GO_WORKER_PORT}. ` +
      'Defaults desalineados dejan a Node y al worker hablando a puertos distintos ' +
      'en cualquier entorno que setee GO_WORKER_PORT para solo uno de los dos procesos.'
  );
});

test('el error de conexión nombra la URL destino y la causa real, no solo "fetch failed"', async () => {
  const prevHost = process.env.GO_WORKER_HOST;
  const prevPort = process.env.GO_WORKER_PORT;
  try {
    process.env.GO_WORKER_HOST = 'localhost';
    process.env.GO_WORKER_PORT = '7452';

    // Reproduce lo que hace `fetch` de Node ante un puerto cerrado: mensaje
    // genérico, con el código real escondido en `cause`.
    const fakeFetch = async () => {
      const error = new Error('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    };

    const run = createRunGoWorker(fakeFetch, { failureThreshold: 99 });
    await assert.rejects(
      () => run('retrieve-item-data', { company_id: 134 }, 1),
      (error) => {
        assert.match(error.message, /http:\/\/localhost:7452\/retrieve-item-data/,
          'el error debe decir a qué URL se intentó conectar');
        assert.match(error.message, /ECONNREFUSED/,
          'el error debe exponer el código real de `cause`, no solo "fetch failed"');
        return true;
      }
    );
  } finally {
    if (prevHost === undefined) delete process.env.GO_WORKER_HOST; else process.env.GO_WORKER_HOST = prevHost;
    if (prevPort === undefined) delete process.env.GO_WORKER_PORT; else process.env.GO_WORKER_PORT = prevPort;
  }
});
