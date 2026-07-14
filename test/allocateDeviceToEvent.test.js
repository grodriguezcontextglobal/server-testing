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

test('allocateDeviceToEvent: 500 "No items to allocate" si la búsqueda no encuentra nada (una sola respuesta)', async () => {
  const controller = createAllocateDeviceToEvent({
    connectionFn: () => mockConnection([]),
    performUpdateLargeDataFn: async () => ({ affectedRows: 0 }),
    performInsertingItemInEventFn: async () => ({}),
  });
  const res = mockRes();

  await controller({ body: { data: ['S1'], company_id: 5, item_group: 'g', category_name: 'c' } }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.jsonCalls, 1);
  assert.equal(res.payload.msg, 'No items to allocate');
});

test('allocateDeviceToEvent: éxito -> UNA sola respuesta con result + updateResult + inserted', async () => {
  const updateCalls = [];
  const insertCalls = [];
  const controller = createAllocateDeviceToEvent({
    connectionFn: () => mockConnection([{ item_id: 200308 }, { item_id: 200309 }]),
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
  assert.deepEqual(res.payload.result, [{ item_id: 200308 }, { item_id: 200309 }]);
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
