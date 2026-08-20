'use strict';

/**
 * allocateDeviceToEvent (mysql/controllers/items_events.js) called
 * updateLargeData(fakeReq, response) and insertingItemInEvent(request, response)
 * directly, reusing the SAME `response` object those Express handlers use to
 * send their own HTTP response — plus its own final `response.status(200).json(...)`.
 * Three attempts to terminate the same response: only the first one
 * (updateLargeData) actually reached the client; Express fails the rest
 * ("Cannot set headers after they are sent"), so the composed result the
 * caller expected (`{inserted, ok, result, updateResult}`) never arrived, and
 * any error from insertingItemInEvent was invisible.
 *
 * Fix: extract performUpdateLargeData (item.js) and performInsertingItemInEvent
 * (this file) as pure functions with no req/res — allocateDeviceToEvent calls
 * those directly and sends exactly ONE response.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  performInsertingItemInEvent,
  createAllocateDeviceToEvent,
} = require('../mysql/controllers/items_events');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    jsonCalls: 0,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonCalls += 1; this.payload = body; return this; },
  };
}

// ─── performInsertingItemInEvent (pure service) ──────────────────────────────

test('performInsertingItemInEvent: lanza 400 si faltan campos requeridos', async () => {
  await assert.rejects(
    () => performInsertingItemInEvent(
      { item_group: 'g', category_name: 'c', company_id: 5, data: ['S1'] }, // sin event_id
      {}
    ),
    /Missing required fields or invalid data format/
  );
});

test('performInsertingItemInEvent: castea company_id/event_id a string y stringifica cada serial', async () => {
  const calls = [];
  await performInsertingItemInEvent(
    { event_id: 42, item_group: 'g', category_name: 'c', company_id: 5, data: [111, 'S2'] },
    { runGoWorkerFn: async (command, payload) => { calls.push({ command, payload }); return { inserted_items: 2, total_items: 2 }; } }
  );

  assert.equal(calls[0].command, 'insert-item-event');
  assert.equal(calls[0].payload.event_id, '42');
  assert.equal(calls[0].payload.company_id, '5');
  assert.deepEqual(calls[0].payload.data, ['111', 'S2']);
});

// ─── createAllocateDeviceToEvent (composes performUpdateLargeData + performInsertingItemInEvent) ──

function mockConnection(rows) {
  return { execute: async () => [rows] };
}

test('allocateDeviceToEvent: 400 si no hay data (una sola respuesta, sin llamar a nada más)', async () => {
  let updateCalls = 0, insertCalls = 0;
  const controller = createAllocateDeviceToEvent({
    connectionFn: () => mockConnection([]),
    performUpdateLargeDataFn: async () => { updateCalls++; },
    performInsertingItemInEventFn: async () => { insertCalls++; },
  });
  const res = mockRes();

  await controller({ body: { data: [] } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.jsonCalls, 1, 'debe responder UNA sola vez');
  assert.equal(updateCalls, 0);
  assert.equal(insertCalls, 0);
});

// Era 500. Que los cuatro filtros (company_id + item_group + category_name +
// serial) no casen es un payload equivocado, no una falla del servidor: como
// 5xx el cliente lo reintentaba en vano y no podía distinguirlo de una caída.
// Caso real que lo disparó: serial '00100003' (un Laptop/Electronics) enviado
// con item_group 'Interpretation Receiver' + category_name 'Receiver'.
test('allocateDeviceToEvent: 422 (no 500) + los seriales no resueltos si la búsqueda no encuentra nada', async () => {
  const controller = createAllocateDeviceToEvent({
    connectionFn: () => mockConnection([]),
    performUpdateLargeDataFn: async () => { throw new Error('no debe llegar acá'); },
    performInsertingItemInEventFn: async () => { throw new Error('no debe llegar acá'); },
  });
  const res = mockRes();

  await controller({ body: { data: ['00100003'], company_id: 147, item_group: 'Interpretation Receiver', category_name: 'Receiver' } }, res);

  assert.equal(res.statusCode, 422);
  assert.equal(res.jsonCalls, 1);
  assert.equal(res.payload.msg, 'No items to allocate', 'el msg se conserva textual por compatibilidad');
  assert.equal(res.payload.ok, false);
  assert.deepEqual(res.payload.unresolved_serials, ['00100003']);
  assert.equal(res.payload.requested_count, 1);
  assert.equal(res.payload.matched_count, 0);
});

// El agujero de datos que cerraba este cambio: con 7 de 10 resueltos respondía
// 200 ok:true y el evento salía con 7 equipos reportados como 10.
test('allocateDeviceToEvent: match parcial -> 200 pero nombrando los seriales que quedaron afuera', async () => {
  const controller = createAllocateDeviceToEvent({
    connectionFn: () => mockConnection([
      { item_id: 1, serial_number: 'RX-100001' },
      { item_id: 2, serial_number: 'RX-100002' },
    ]),
    performUpdateLargeDataFn: async () => ({ affectedRows: 2 }),
    performInsertingItemInEventFn: async () => ({ inserted_items: 2, total_items: 2 }),
  });
  const res = mockRes();

  await controller({
    body: {
      event_id: 687,
      company_id: 147,
      item_group: 'Interpretation Receiver',
      category_name: 'Receiver',
      data: ['RX-100001', 'RX-100002', 'RX-999999'],
      warehouse: 0,
      logistic_status: 'in-event',
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.requested_count, 3);
  assert.equal(res.payload.matched_count, 2);
  assert.deepEqual(res.payload.unresolved_serials, ['RX-999999']);
});

test('allocateDeviceToEvent: match completo -> unresolved_serials vacío', async () => {
  const controller = createAllocateDeviceToEvent({
    connectionFn: () => mockConnection([{ item_id: 1, serial_number: 'RX-100001' }]),
    performUpdateLargeDataFn: async () => ({ affectedRows: 1 }),
    performInsertingItemInEventFn: async () => ({ inserted_items: 1, total_items: 1 }),
  });
  const res = mockRes();

  await controller({ body: { data: ['RX-100001'], company_id: 147, item_group: 'g', category_name: 'c' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.unresolved_serials, []);
  assert.equal(res.payload.matched_count, 1);
  assert.equal(res.payload.requested_count, 1);
});

// Un serial numérico enviado como number no debe reportarse como no resuelto
// solo porque mysql2 devuelve la columna como string (o al revés).
test('allocateDeviceToEvent: compara seriales por string, no por tipo', async () => {
  const controller = createAllocateDeviceToEvent({
    connectionFn: () => mockConnection([{ item_id: 1, serial_number: '100003' }]),
    performUpdateLargeDataFn: async () => ({ affectedRows: 1 }),
    performInsertingItemInEventFn: async () => ({ inserted_items: 1, total_items: 1 }),
  });
  const res = mockRes();

  await controller({ body: { data: [100003], company_id: 147, item_group: 'g', category_name: 'c' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.unresolved_serials, []);
});

test('allocateDeviceToEvent: éxito -> UNA sola respuesta con result + updateResult + inserted', async () => {
  const updateCalls = [];
  const insertCalls = [];
  const controller = createAllocateDeviceToEvent({
    connectionFn: () => mockConnection([
      { item_id: 200308, serial_number: 'S1' },
      { item_id: 200309, serial_number: 'S2' },
    ]),
    performUpdateLargeDataFn: async (params) => { updateCalls.push(params); return { affectedRows: 2 }; },
    performInsertingItemInEventFn: async (params) => { insertCalls.push(params); return { inserted_items: 2, total_items: 2 }; },
  });
  const res = mockRes();

  await controller({
    body: {
      event_id: 42,
      company_id: 5,
      item_group: 'Cameras',
      category_name: 'DSLR',
      data: ['S1', 'S2'],
      warehouse: 0,
      logistic_status: 'in-transit',
    },
  }, res);

  assert.equal(res.jsonCalls, 1, 'debe responder UNA sola vez, no tres');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.deepEqual(res.payload.result, [
    { item_id: 200308, serial_number: 'S1' },
    { item_id: 200309, serial_number: 'S2' },
  ]);
  assert.deepEqual(res.payload.unresolved_serials, []);
  assert.deepEqual(res.payload.updateResult, { affectedRows: 2 });
  assert.deepEqual(res.payload.inserted, { inserted_items: 2, total_items: 2 });

  // Los item_ids resueltos por la SELECT se reenvían al update, junto con el
  // company_id y los updates armados desde warehouse/logistic_status del body.
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].item_ids, [200308, 200309]);
  assert.equal(updateCalls[0].company_id, 5);
  assert.deepEqual(updateCalls[0].updates, { logistic_status: 'in-transit', warehouse: 0 });
  assert.equal(insertCalls.length, 1);
  assert.equal(insertCalls[0].event_id, 42);
});

test('allocateDeviceToEvent: si performUpdateLargeData falla, responde UNA sola vez (no sigue a insertingItemInEvent)', async () => {
  let insertCalls = 0;
  const controller = createAllocateDeviceToEvent({
    connectionFn: () => mockConnection([{ item_id: 200308 }]),
    performUpdateLargeDataFn: async () => { const e = new Error('company_id is required'); e.statusCode = 400; throw e; },
    performInsertingItemInEventFn: async () => { insertCalls++; return {}; },
  });
  const res = mockRes();

  await controller({ body: { data: ['S1'], company_id: 5, item_group: 'g', category_name: 'c' } }, res);

  assert.equal(res.jsonCalls, 1);
  assert.equal(res.statusCode, 400);
  assert.equal(insertCalls, 0, 'no debe seguir al siguiente paso si el update falló');
});
