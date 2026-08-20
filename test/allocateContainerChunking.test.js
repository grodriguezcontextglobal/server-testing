'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// allocateDeviceMarkedAsContainerInEvent armaba UN placeholder por item ya
// EXPANDIDO (contenedores + su contenido) en una sola sentencia: 500
// contenedores de 20 hijos = 10.500 placeholders, arriba del
// max_allowed_packet / del límite de Vitess. Ahora trocea, y estos tests fijan
// que el troceo pasa DENTRO de la misma transacción (sigue siendo todo-o-nada).
const {
  chunkList,
  createAllocateDeviceMarkedAsContainerInEvent,
} = require('../mysql/controllers/items_events');

// ─── helpers ─────────────────────────────────────────────────────────────────

// Conexión falsa que clasifica cada execute() por su SQL y devuelve filas
// preparadas por llamada, para poder contar cuántas sentencias se emitieron.
function makeFakeConnection({ containerRows = [], childRows = [] } = {}) {
  const calls = [];
  let containerCall = 0;
  let childCall = 0;

  const connection = {
    beginTransaction: async () => { calls.push({ kind: 'begin' }); },
    commit: async () => { calls.push({ kind: 'commit' }); },
    rollback: async () => { calls.push({ kind: 'rollback' }); },
    release: () => { calls.push({ kind: 'release' }); },
    execute: async (sql, values) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();

      if (s.includes('FROM container_items')) {
        calls.push({ kind: 'containers', values });
        return [containerRows[containerCall++] ?? []];
      }
      if (s.startsWith('UPDATE item_inv')) {
        calls.push({ kind: 'update', values });
        return [{ affectedRows: values.length - 3 }];
      }
      if (s.includes('INSERT IGNORE INTO item_inv_assigned_event')) {
        calls.push({ kind: 'insert', sql: s, values });
        return [{ affectedRows: values.length / 2 }];
      }
      if (s.includes('SELECT item_group, category_name, serial_number')) {
        calls.push({ kind: 'children', values });
        return [childRows[childCall++] ?? []];
      }
      if (s.includes('company_name FROM company_info')) {
        calls.push({ kind: 'company', values });
        return [[{ company_name: 'ACME' }]];
      }
      calls.push({ kind: 'unknown', sql: s });
      return [[]];
    },
  };

  return {
    calls,
    connectionFn: () => ({ getConnection: async () => connection }),
  };
}

function makeResponse() {
  const sent = {};
  const response = {
    status(code) { sent.code = code; return this; },
    json(body) { sent.body = body; return this; },
  };
  return { response, sent };
}

const kinds = (calls, kind) => calls.filter((c) => c.kind === kind);

const baseBody = (data) => ({
  company_id: 137,
  event_id: 4242,
  data,
  warehouse: 0,
  logistic_status: 'in-event',
  eventName: 'Expo',
  company_id_nosql: 'abc123',
});

// ─── chunkList ───────────────────────────────────────────────────────────────

test('chunkList: parte en lotes del tamaño pedido y no pierde elementos', () => {
  assert.deepEqual(chunkList([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkList([1, 2], 5), [[1, 2]]);
  assert.deepEqual(chunkList([], 5), []);
});

// ─── troceo de las sentencias sobre items expandidos ─────────────────────────

test('allocateDeviceMarkedAsContainerInEvent: trocea UPDATE e INSERT, todo en UNA transacción', async () => {
  // 1 contenedor (item 10) con 3 hijos -> 4 items expandidos, chunkSize 2 -> 2 lotes.
  const { calls, connectionFn } = makeFakeConnection({
    containerRows: [[{ item_id: 10, child_ids: JSON.stringify([11, 12, 13]) }]],
    childRows: [
      [{ item_group: 'receiver', category_name: 'A', serial_number: 'S11' },
       { item_group: 'receiver', category_name: 'A', serial_number: 'S12' }],
      [{ item_group: 'receiver', category_name: 'A', serial_number: 'S13' }],
    ],
  });
  const pooled = [];
  const handler = createAllocateDeviceMarkedAsContainerInEvent({
    connectionFn,
    poolReceiversBulkFn: async (payload) => { pooled.push(payload); },
    chunkSize: 2,
  });

  const { response, sent } = makeResponse();
  await handler({ body: baseBody(['CONT-1']) }, response);

  assert.equal(sent.code, 200);
  assert.deepEqual(sent.body.result.allItemsToProcess, [10, 11, 12, 13]);

  // Dos lotes de UPDATE y dos de INSERT, no una sentencia gigante.
  assert.equal(kinds(calls, 'update').length, 2);
  assert.equal(kinds(calls, 'insert').length, 2);

  // Los valores de cada lote: UPDATE lleva [warehouse, logistic_status, company_id, ...items]
  assert.deepEqual(kinds(calls, 'update')[0].values, [0, 'in-event', 137, 10, 11]);
  assert.deepEqual(kinds(calls, 'update')[1].values, [0, 'in-event', 137, 12, 13]);
  // INSERT lleva pares (event_id, item_id)
  assert.deepEqual(kinds(calls, 'insert')[0].values, [4242, 10, 4242, 11]);
  assert.deepEqual(kinds(calls, 'insert')[1].values, [4242, 12, 4242, 13]);

  // Un solo begin y un solo commit: los lotes no se auto-commitean por separado.
  assert.equal(kinds(calls, 'begin').length, 1);
  assert.equal(kinds(calls, 'commit').length, 1);
  assert.equal(kinds(calls, 'rollback').length, 0);
  assert.equal(kinds(calls, 'release').length, 1);
  assert.equal(calls[0].kind, 'begin');
});

test('allocateDeviceMarkedAsContainerInEvent: el INSERT sigue siendo IGNORE (reasignar al mismo evento no explota)', async () => {
  const { calls, connectionFn } = makeFakeConnection({
    containerRows: [[{ item_id: 10, child_ids: null }]],
  });
  const handler = createAllocateDeviceMarkedAsContainerInEvent({
    connectionFn,
    poolReceiversBulkFn: async () => {},
    chunkSize: 1000,
  });

  const { response, sent } = makeResponse();
  await handler({ body: baseBody(['CONT-1']) }, response);

  assert.equal(sent.code, 200);
  const inserts = kinds(calls, 'insert');
  assert.equal(inserts.length, 1);
  assert.ok(
    inserts[0].sql.includes('INSERT IGNORE INTO item_inv_assigned_event'),
    'el INSERT del camino síncrono debe seguir siendo IGNORE',
  );
});

test('allocateDeviceMarkedAsContainerInEvent: trocea también la búsqueda de contenedores por serial y acumula los resultados', async () => {
  // 3 seriales, chunkSize 2 -> 2 SELECT sobre container_items; los contenedores
  // encontrados en el segundo lote no se pueden perder.
  const { calls, connectionFn } = makeFakeConnection({
    containerRows: [
      [{ item_id: 10, child_ids: null }],
      [{ item_id: 20, child_ids: null }],
    ],
  });
  const handler = createAllocateDeviceMarkedAsContainerInEvent({
    connectionFn,
    poolReceiversBulkFn: async () => {},
    chunkSize: 2,
  });

  const { response, sent } = makeResponse();
  await handler({ body: baseBody(['A', 'B', 'C']) }, response);

  assert.equal(sent.code, 200);
  assert.equal(kinds(calls, 'containers').length, 2);
  assert.deepEqual(kinds(calls, 'containers')[0].values, ['A', 'B', 137]);
  assert.deepEqual(kinds(calls, 'containers')[1].values, ['C', 137]);
  assert.deepEqual(sent.body.result.allItemsToProcess, [10, 20]);
});

test('allocateDeviceMarkedAsContainerInEvent: los props de los hijos se acumulan entre lotes y van en UN solo push al pool', async () => {
  const { calls, connectionFn } = makeFakeConnection({
    containerRows: [[{ item_id: 10, child_ids: [11, 12, 13] }]],
    childRows: [
      [{ item_group: 'receiver', category_name: 'A', serial_number: 'S11' },
       { item_group: 'receiver', category_name: 'A', serial_number: 'S12' }],
      [{ item_group: 'receiver', category_name: 'B', serial_number: 'S13' }],
    ],
  });
  const pooled = [];
  const handler = createAllocateDeviceMarkedAsContainerInEvent({
    connectionFn,
    poolReceiversBulkFn: async (payload) => { pooled.push(payload); },
    chunkSize: 2,
  });

  const { response, sent } = makeResponse();
  await handler({ body: baseBody(['CONT-1']) }, response);

  assert.equal(kinds(calls, 'children').length, 2);
  assert.equal(sent.body.props.length, 3);

  // El endpoint YA escribe el pool de receivers: un solo push con los 3 hijos.
  // (Si el cliente además llama /api/receivers/receivers-pool-bulk, duplica.)
  assert.equal(pooled.length, 1);
  assert.deepEqual(pooled[0].deviceList.map((d) => d.device), ['S11', 'S12', 'S13']);
  assert.equal(pooled[0].provider, 'ACME');
});

// ─── comportamiento preexistente que el troceo no debe cambiar ───────────────

test('allocateDeviceMarkedAsContainerInEvent: 404 + rollback si ningún serial resuelve a contenedor', async () => {
  const { calls, connectionFn } = makeFakeConnection({ containerRows: [[]] });
  const handler = createAllocateDeviceMarkedAsContainerInEvent({
    connectionFn,
    poolReceiversBulkFn: async () => { throw new Error('no debe tocar el pool'); },
    chunkSize: 1000,
  });

  const { response, sent } = makeResponse();
  await handler({ body: baseBody(['NOPE']) }, response);

  assert.equal(sent.code, 404);
  assert.equal(kinds(calls, 'rollback').length, 1);
  assert.equal(kinds(calls, 'commit').length, 0);
  assert.equal(kinds(calls, 'update').length, 0);
});

test('allocateDeviceMarkedAsContainerInEvent: 400 sin company_id/event_id y sin abrir transacción', async () => {
  const { calls, connectionFn } = makeFakeConnection({});
  const handler = createAllocateDeviceMarkedAsContainerInEvent({ connectionFn, chunkSize: 1000 });

  const { response, sent } = makeResponse();
  await handler({ body: { event_id: 1, data: ['A'] } }, response);

  assert.equal(sent.code, 400);
  assert.equal(calls.length, 0, 'no debe pedir conexión si la validación falla');
});

// NOTA: la rama 200 "The specified containers are empty." es inalcanzable hoy —
// containers.length > 0 implica containerItemIds.length > 0, así que
// allItemsToProcess nunca queda vacío. Es preexistente; no se toca acá.
