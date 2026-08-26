'use strict';

/**
 * Un error REPORTADO por el Go worker (HTTP 200 con status:"error") no es lo
 * mismo que un fallo de transporte, y antes se trataban igual.
 *
 * Caso real que lo destapó: POST /api/db_inventory/update-large-data con
 * `updates.return_date`, una columna que no estaba en la lista blanca de
 * UpdateItemWarehouse. El worker contestó correctamente rechazándola, y el
 * cliente recibió:
 *
 *   "Go Worker Connection Failed after 3 attempts to http://localhost:7452/
 *    update-item-warehouse: Update item warehouse failed: disallowed column
 *    for update: return_date. Ensure the Go worker is running and reachable"
 *
 * Tres cosas mal: se reintentó 3 veces algo determinista, el mensaje culpó a la
 * conectividad y al puerto, y el fallo contó para el circuit breaker (5 de
 * estos seguidos dejan al Go worker inalcanzable para toda la app por 30s).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const runGoWorker = require('../helpers/goWorker');
const { createRunGoWorker, GoWorkerReportedError } = runGoWorker;

const workerRejects = (message) => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'error', message }),
    };
  };
  return { fetchImpl, calls: () => calls };
};

const transportFails = () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  };
  return { fetchImpl, calls: () => calls };
};

// ─── Error reportado por el worker ───────────────────────────────────────────

test('un error del worker NO se reintenta: un solo viaje', async () => {
  const { fetchImpl, calls } = workerRejects('disallowed column(s) for update: return_date');
  const call = createRunGoWorker(fetchImpl);

  await assert.rejects(() => call('update-item-warehouse', {}));
  assert.equal(calls(), 1, 'era determinista: reintentarlo da el mismo error');
});

test('el mensaje sale tal cual, sin culpar a la conectividad ni al puerto', async () => {
  const { fetchImpl } = workerRejects('disallowed column(s) for update: return_date, returnedRentedInfo');
  const call = createRunGoWorker(fetchImpl);

  const error = await call('update-item-warehouse', {}).catch((e) => e);

  assert.equal(error.message, 'disallowed column(s) for update: return_date, returnedRentedInfo');
  assert.ok(!/Connection Failed/.test(error.message), 'no debe decir Connection Failed');
  assert.ok(!/running and reachable/.test(error.message), 'no debe mandar a revisar el servicio');
  assert.ok(!/localhost:\d+/.test(error.message), 'no debe mandar a revisar el puerto');
});

test('el error viene etiquetado y nombra el comando', async () => {
  const { fetchImpl } = workerRejects('company_id is required');
  const call = createRunGoWorker(fetchImpl);

  const error = await call('delete-bulk-items', {}).catch((e) => e);

  assert.ok(error instanceof GoWorkerReportedError);
  assert.equal(error.workerReported, true);
  assert.equal(error.command, 'delete-bulk-items');
});

test('no cuenta para el circuit breaker: al sexto payload malo el worker sigue accesible', async () => {
  let goodCalls = 0;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.bad) {
      return { ok: true, status: 200, json: async () => ({ status: 'error', message: 'disallowed column(s) for update: x' }) };
    }
    goodCalls += 1;
    return { ok: true, status: 200, json: async () => ({ status: 'success', data: { affectedRows: 1 } }) };
  };
  const call = createRunGoWorker(fetchImpl, { failureThreshold: 5 });

  // failureThreshold=5 -> con el comportamiento viejo, estos 6 abrían el circuito
  for (let i = 0; i < 6; i++) {
    await assert.rejects(() => call('update-item-warehouse', { bad: true }));
  }

  const data = await call('update-item-warehouse', { bad: false });
  assert.deepEqual(data, { affectedRows: 1 });
  assert.equal(goodCalls, 1, 'la llamada legítima debe haber llegado al worker');
});

// ─── Fallo de transporte: el comportamiento de antes, intacto ────────────────

test('un fallo de transporte SÍ se reintenta y sí explica dónde intentó conectar', async () => {
  const { fetchImpl, calls } = transportFails();
  const call = createRunGoWorker(fetchImpl);

  const error = await call('check-item', {}).catch((e) => e);

  assert.equal(calls(), 3, 'las 3 intentonas del retry siguen ahí');
  assert.match(error.message, /Go Worker Connection Failed after 3 attempts/);
  assert.match(error.message, /ECONNREFUSED/, 'el cause real sigue apareciendo');
  assert.match(error.message, /http:\/\/[^/]+\/check-item/, 'y la URL a la que intentó');
  assert.ok(!error.workerReported, 'no es un error reportado por el worker');
});

test('un fallo de transporte sí abre el circuito', async () => {
  const { fetchImpl } = transportFails();
  const call = createRunGoWorker(fetchImpl, { failureThreshold: 2 });

  await assert.rejects(() => call('check-item', {}));
  await assert.rejects(() => call('check-item', {}));

  const error = await call('check-item', {}).catch((e) => e);
  assert.match(error.message, /circuit|breaker|open/i, `el 3er intento debe fallar rápido: ${error.message}`);
});

// ─── Éxito ───────────────────────────────────────────────────────────────────

test('una respuesta exitosa sigue devolviendo `data` desempaquetado', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'success', message: 'ok', data: { affectedRows: 7 } }),
  });
  const call = createRunGoWorker(fetchImpl);
  assert.deepEqual(await call('update-item-warehouse', {}), { affectedRows: 7 });
});
