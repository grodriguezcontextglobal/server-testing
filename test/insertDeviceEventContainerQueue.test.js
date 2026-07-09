'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// insertingDeviceInEventDirectlyFromContainer era la única mutación del Go
// worker verdaderamente fire-and-forget (no usaba el resultado en la
// respuesta) — se migró a la cola. Ver DESIGN_task_queue.md § Fase 2.
const { buildInsertDeviceEventContainerPayload } = require('../mysql/controllers/items_events');

test('buildInsertDeviceEventContainerPayload: castea event_id a string y conserva refDatabase', () => {
  const payload = buildInsertDeviceEventContainerPayload({ event_id: 123, refDatabase: { a: 1 } });
  assert.equal(payload.event_id, '123');
  assert.deepEqual(payload.refDatabase, { a: 1 });
});
