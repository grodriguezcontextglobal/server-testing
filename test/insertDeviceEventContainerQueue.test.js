'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// insertingDeviceInEventDirectlyFromContainer era la única mutación del Go
// worker verdaderamente fire-and-forget (no usaba el resultado en la
// respuesta) — se migró a la cola. Ver DESIGN_task_queue.md § Fase 2.
const {
  buildInsertDeviceEventContainerIdempotencyKey,
  buildInsertDeviceEventContainerPayload,
} = require('../mysql/controllers/items_events');

test('buildInsertDeviceEventContainerPayload: castea event_id a string y conserva refDatabase', () => {
  const payload = buildInsertDeviceEventContainerPayload({ event_id: 123, refDatabase: { a: 1 } });
  assert.equal(payload.event_id, '123');
  assert.deepEqual(payload.refDatabase, { a: 1 });
});

// Sin dedup, el retry automático del cliente reencolaba el mismo lote de 500 y
// se insertaba dos veces. La clave se namespacea por tipo de job para que la
// misma clave del cliente en otro endpoint no colisione.
test('buildInsertDeviceEventContainerIdempotencyKey: namespacea la clave del header', () => {
  const key = buildInsertDeviceEventContainerIdempotencyKey(
    {},
    { get: (h) => (h.toLowerCase() === 'idempotency-key' ? 'abc-123' : undefined) },
  );
  assert.equal(key, 'go-worker:insert-device-event-container:abc-123');
});

test('buildInsertDeviceEventContainerIdempotencyKey: acepta el header en minúsculas y recorta espacios', () => {
  const key = buildInsertDeviceEventContainerIdempotencyKey(
    {},
    { get: (h) => (h === 'idempotency-key' ? '  abc-123  ' : undefined) },
  );
  assert.equal(key, 'go-worker:insert-device-event-container:abc-123');
});

test('buildInsertDeviceEventContainerIdempotencyKey: sin header (o vacío) no deduplica', () => {
  assert.equal(buildInsertDeviceEventContainerIdempotencyKey({}, { get: () => undefined }), undefined);
  assert.equal(buildInsertDeviceEventContainerIdempotencyKey({}, { get: () => '   ' }), undefined);
  assert.equal(buildInsertDeviceEventContainerIdempotencyKey({}, {}), undefined);
  assert.equal(buildInsertDeviceEventContainerIdempotencyKey({}, undefined), undefined);
});
