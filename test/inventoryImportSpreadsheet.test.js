'use strict';

/**
 * Import de inventario desde hoja de cálculo —
 * POST /api/db_item/bulk-item-from-spreadsheet.
 *
 * Lo que estas pruebas protegen de verdad es UNA cosa: que cada unidad se
 * escriba con SUS valores. El endpoint viejo copia los escalares del cuerpo
 * sobre todo el lote, y sobre un fichero real de 500 unidades eso escribía el
 * coste de otra fila en 482 de ellas sin rechazar nada. Es un fallo que no se
 * nota: el import dice que fue bien.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  validateImportBody,
  checkImportScope,
  buildLocationLookupQuery,
  buildExistingSerialsQuery,
  distinctLocationNames,
  ImportValidationError,
  MAX_IMPORT_UNITS,
} = require('../mysql/queries/inventoryImportQuery');

const { createPostInventoryImport, JOB_TYPE } = require('../mysql/controllers/inventoryImport');
const { createInventoryImportHandler, buildUnitRow, withDefaults, INSERT_QUERY } =
  require('../queue/handlers/inventoryImportSpreadsheet');

// ─── Ayudas ──────────────────────────────────────────────────────────────────

const unit = (over = {}) => ({
  serial_number: 'AUD-1',
  category_name: 'Audio',
  item_group: 'Wireless Microphone',
  brand: 'Shure',
  cost: 258.42,
  location: 'Miami, FL',
  ...over,
});

const mockResponse = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const mockRequest = (body, { uid = 'staff-1', headers = {} } = {}) => ({
  body,
  sqlStaffId: 10,
  get: (name) => headers[name] || headers[String(name).toLowerCase()],
  __uid: uid,
});

// ─── Validación del fichero ──────────────────────────────────────────────────

test('un cuerpo sin units no se encola', () => {
  assert.throws(() => validateImportBody({}), ImportValidationError);
  assert.throws(() => validateImportBody({ units: [] }), ImportValidationError);
});

test('el techo de unidades se dice con el número, no con un "too large"', () => {
  const units = Array.from({ length: MAX_IMPORT_UNITS + 1 }, (_, i) =>
    unit({ serial_number: `S-${i}` })
  );
  assert.throws(
    () => validateImportBody({ units }),
    (err) => err instanceof ImportValidationError && err.message.includes(String(MAX_IMPORT_UNITS))
  );
});

test('sin `row`, las filas malas caen al respaldo de índice+2', () => {
  // El respaldo, no el caso bueno: cuando el cliente manda `row` (lo normal),
  // ese es el que se devuelve — ver la prueba de abajo.
  try {
    validateImportBody({
      units: [unit(), unit({ serial_number: '' }), unit({ serial_number: 'X', category_name: '' })],
    });
    assert.fail('debería haber lanzado');
  } catch (err) {
    assert.ok(err instanceof ImportValidationError);
    assert.deepStrictEqual(
      err.errors.map((e) => e.row),
      [3, 4]
    );
    assert.match(err.errors[0].reason, /serial_number/);
    assert.match(err.errors[1].reason, /category_name/);
  }
});

test('el `row` que manda el cliente se devuelve TAL CUAL, sin recalcularlo', () => {
  // El cliente descarta filas antes de enviar (las que no traen una columna
  // obligatoria), asi que su array llega comprimido: derivar indice+2 apunta a
  // una fila que ni siquiera se mando. Ver
  // FRONTEND_inventory_import_endpoint_REPLY_2026-09-22.md §2.
  try {
    validateImportBody({
      units: [
        unit({ row: 2, serial_number: 'AUD-1' }),
        unit({ row: 4, serial_number: '' }), // en el fichero es la 4, no la 3
      ],
    });
    assert.fail('debería haber lanzado');
  } catch (err) {
    assert.deepStrictEqual(err.errors.map((e) => e.row), [4]);
  }
});

test('el `row` del cliente viaja hasta las unidades y hasta skipped', () => {
  const { units, skipped } = validateImportBody({
    units: [
      unit({ row: 7, serial_number: 'A-1' }),
      unit({ row: 19, serial_number: 'A-1' }),
    ],
  });
  assert.deepStrictEqual(units.map((u) => u.row), [7]);
  assert.strictEqual(skipped[0].row, 19);
});

test('sin `row`, se cae a la posición del array (y eso NO es la fila del fichero)', () => {
  const { units } = validateImportBody({ units: [unit({ serial_number: 'A-1' })] });
  assert.strictEqual(units[0].row, 2);
});

test('un `row` que no es un entero positivo se ignora en vez de propagarse', () => {
  const { units } = validateImportBody({
    units: [
      unit({ row: 'catorce', serial_number: 'A-1' }),
      unit({ row: -3, serial_number: 'A-2' }),
      unit({ row: 2.5, serial_number: 'A-3' }),
    ],
  });
  assert.deepStrictEqual(units.map((u) => u.row), [2, 3, 4]);
});

test('una unidad sin locación es fila mala: location_id no se puede inventar', () => {
  assert.throws(
    () => validateImportBody({ units: [unit({ location: '' })] }),
    /cannot be imported/
  );
});

test('un serial repetido DENTRO del fichero no tumba el import: se salta y se reporta', () => {
  const { units, skipped } = validateImportBody({
    units: [unit({ serial_number: 'A-1' }), unit({ serial_number: 'a-1' }), unit({ serial_number: 'A-2' })],
  });
  assert.deepStrictEqual(units.map((u) => u.serial_number), ['A-1', 'A-2']);
  assert.strictEqual(skipped.length, 1);
  assert.match(skipped[0].reason, /duplicate/);
});

test('el coste aguanta lo que trae una hoja de verdad', () => {
  const { units } = validateImportBody({
    units: [
      unit({ serial_number: 'A', cost: '$1,234.56' }),
      unit({ serial_number: 'B', cost: '' }),
      unit({ serial_number: 'C', cost: 'n/a' }),
      unit({ serial_number: 'D', cost: 99.5 }),
    ],
  });
  assert.deepStrictEqual(units.map((u) => u.cost), [1234.56, 0, 0, 99.5]);
});

test('sub_location se acepta como array, como JSON string y como nombre suelto', () => {
  const { units } = validateImportBody({
    units: [
      unit({ serial_number: 'A', sub_location: ['Section A', 'Locker A110'] }),
      unit({ serial_number: 'B', sub_location: '["Section B"]' }),
      unit({ serial_number: 'C', sub_location: 'Section C' }),
      unit({ serial_number: 'D', sub_location: null }),
    ],
  });
  assert.deepStrictEqual(units.map((u) => u.sub_location_segments), [
    ['Section A', 'Locker A110'],
    ['Section B'],
    ['Section C'],
    [],
  ]);
});

test('la locación puede venir como objeto {name}, como ya circula por el sistema', () => {
  const { units } = validateImportBody({ units: [unit({ location: { name: 'Orlando, FL' } })] });
  assert.strictEqual(units[0].location_name, 'Orlando, FL');
});

test('sin main_warehouse, la unidad se almacena donde está: en su locación', () => {
  const { units } = validateImportBody({ units: [unit({ main_warehouse: undefined })] });
  assert.strictEqual(units[0].main_warehouse, 'Miami, FL');
});

// ─── Scope sobre el fichero entero ───────────────────────────────────────────

test('un rol sin scope importa el fichero completo', () => {
  const check = checkImportScope(
    { full: true },
    { locationIdsByName: new Map(), locationNames: ['A'], categoryNames: ['Audio'] }
  );
  assert.strictEqual(check.ok, true);
});

test('un rol por locación necesita TODAS las locaciones del fichero, no la primera', () => {
  const locationIdsByName = new Map([['Miami, FL', 5], ['Orlando, FL', 9]]);
  const ok = checkImportScope(
    { full: false, dimension: 'location', values: [5, 9] },
    { locationIdsByName, locationNames: ['Miami, FL', 'Orlando, FL'], categoryNames: ['Audio'] }
  );
  assert.strictEqual(ok.ok, true);

  const denied = checkImportScope(
    { full: false, dimension: 'location', values: [5] },
    { locationIdsByName, locationNames: ['Miami, FL', 'Orlando, FL'], categoryNames: ['Audio'] }
  );
  assert.strictEqual(denied.ok, false);
  // El mensaje nombra la que sobra: es lo único accionable sobre la hoja.
  assert.match(denied.msg, /Orlando, FL/);
});

test('un rol por locación NO crea locaciones nuevas de rebote', () => {
  // Crear la locación que falta y luego escribir en ella sería ampliarse el
  // propio scope: una locación que no existe no puede estar en el permiso.
  const denied = checkImportScope(
    { full: false, dimension: 'location', values: [5] },
    {
      locationIdsByName: new Map([['Miami, FL', 5]]),
      locationNames: ['Miami, FL', 'Tampa, FL'],
      categoryNames: ['Audio'],
    }
  );
  assert.strictEqual(denied.ok, false);
  assert.match(denied.msg, /Tampa, FL/);
  assert.match(denied.msg, /cannot create locations/);
});

test('un rol por categoría se comprueba contra todas las categorías del fichero', () => {
  const target = {
    locationIdsByName: new Map([['Miami, FL', 5]]),
    locationNames: ['Miami, FL'],
    categoryNames: ['Audio', 'Video'],
  };
  assert.strictEqual(
    checkImportScope({ full: false, dimension: 'category', values: ['Audio', 'Video'] }, target).ok,
    true
  );
  const denied = checkImportScope(
    { full: false, dimension: 'category', values: ['Audio'] },
    target
  );
  assert.strictEqual(denied.ok, false);
  assert.match(denied.msg, /Video/);
});

test('un scope vacío no deja escribir nada (falla cerrado)', () => {
  const denied = checkImportScope(
    { full: false, dimension: 'location', values: [] },
    {
      locationIdsByName: new Map([['Miami, FL', 5]]),
      locationNames: ['Miami, FL'],
      categoryNames: ['Audio'],
    }
  );
  assert.strictEqual(denied.ok, false);
});

// ─── Las consultas ───────────────────────────────────────────────────────────

test('las locaciones del fichero se resuelven en UNA consulta', () => {
  const { sql, params } = buildLocationLookupQuery(7, ['Miami, FL', 'Orlando, FL']);
  assert.match(sql, /IN \(\?, \?\)/);
  assert.deepStrictEqual(params, [7, 'Miami, FL', 'Orlando, FL']);
});

test('el chequeo de seriales existentes va parametrizado, no interpolado', () => {
  const { sql, params } = buildExistingSerialsQuery(7, ["A-1'; DROP TABLE item_inv; --"]);
  assert.match(sql, /IN \(\?\)/);
  assert.strictEqual(params[1], "A-1'; DROP TABLE item_inv; --");
});

// ─── Controller ──────────────────────────────────────────────────────────────

const controllerDeps = (over = {}) => {
  const enqueued = [];
  const deps = {
    resolveAccessFn: async () => ({ companyId: 7, access: { scoped: false }, scope: {} }),
    getWritableScopeFn: async () => ({ full: true }),
    connectionFn: () => ({ execute: async () => [[{ location_id: 5, location_name: 'Miami, FL' }]] }),
    extractContextFn: () => ({ uid: 'staff-1' }),
    enqueueFn: async (type, payload, opts) => {
      enqueued.push({ type, payload, opts });
      return { id: 'job-1' };
    },
    ...over,
  };
  return { deps, enqueued };
};

test('el camino feliz: 202, jobId y una fila por unidad en el payload', async () => {
  const { deps, enqueued } = controllerDeps();
  const controller = createPostInventoryImport(deps);
  const res = mockResponse();

  await controller(
    mockRequest({ company_id: 7, company: 'ABC', units: [unit({ serial_number: 'A-1' }), unit({ serial_number: 'A-2' })] }),
    res
  );

  assert.strictEqual(res.statusCode, 202);
  assert.strictEqual(res.body.jobId, 'job-1');
  assert.strictEqual(res.body.units, 2);
  assert.strictEqual(enqueued[0].type, JOB_TYPE);
  assert.strictEqual(enqueued[0].payload.units.length, 2);
  // Los ids ya resueltos viajan con el job para no repetir la consulta.
  assert.deepStrictEqual(enqueued[0].payload.locationIds, { 'Miami, FL': 5 });
});

test('un fichero con filas malas da 400 con las filas, y NO encola', async () => {
  const { deps, enqueued } = controllerDeps();
  const controller = createPostInventoryImport(deps);
  const res = mockResponse();

  await controller(mockRequest({ company_id: 7, units: [unit({ serial_number: '' })] }), res);

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.errors.length, 1);
  assert.strictEqual(res.body.limit, MAX_IMPORT_UNITS);
  assert.strictEqual(enqueued.length, 0);
});

test('fuera de scope: 403 y nada encolado', async () => {
  const { deps, enqueued } = controllerDeps({
    getWritableScopeFn: async () => ({ full: false, dimension: 'category', values: ['Video'] }),
  });
  const controller = createPostInventoryImport(deps);
  const res = mockResponse();

  await controller(mockRequest({ company_id: 7, units: [unit()] }), res);

  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.msg, /Audio/);
  assert.strictEqual(enqueued.length, 0);
});

test('sin uid no se encola: el job sería inalcanzable por su dueño', async () => {
  const { deps, enqueued } = controllerDeps({ extractContextFn: () => ({}) });
  const controller = createPostInventoryImport(deps);
  const res = mockResponse();

  await controller(mockRequest({ company_id: 7, units: [unit()] }), res);

  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(enqueued.length, 0);
});

test('si resolveAccess ya respondió, el controller no encola', async () => {
  const { deps, enqueued } = controllerDeps({ resolveAccessFn: async () => null });
  const controller = createPostInventoryImport(deps);
  const res = mockResponse();

  await controller(mockRequest({ company_id: 7, units: [unit()] }), res);

  assert.strictEqual(res.statusCode, null);
  assert.strictEqual(enqueued.length, 0);
});

test('el Idempotency-Key va namespaced por tipo de job', async () => {
  const { deps, enqueued } = controllerDeps();
  const controller = createPostInventoryImport(deps);
  const res = mockResponse();

  await controller(
    mockRequest({ company_id: 7, units: [unit()] }, { headers: { 'Idempotency-Key': 'abc' } }),
    res
  );

  assert.strictEqual(enqueued[0].opts.idempotencyKey, `${JOB_TYPE}:abc`);
});

// ─── Handler ─────────────────────────────────────────────────────────────────

const mockPool = ({ existingSerials = [], failBatch = false, failSerials = [] } = {}) => {
  const calls = { inserts: [], transactions: 0, rollbacks: 0 };
  const connection = {
    execute: async (sql) => {
      if (/FROM item_inv/.test(sql)) {
        return [existingSerials.map((serial_number) => ({ serial_number }))];
      }
      return [[]];
    },
    query: async (sql, params) => {
      const rows = params[0];
      calls.inserts.push(rows);
      const serialIndex = 6; // posición de serial_number en INSERT_QUERY
      const offending = rows.filter((r) => failSerials.includes(r[serialIndex]));
      if (offending.length > 0) throw new Error(`Duplicate entry '${offending[0][serialIndex]}'`);
      if (failBatch && rows.length > 1) throw new Error('batch exploded');
      return [{ affectedRows: rows.length }];
    },
    beginTransaction: async () => {
      calls.transactions += 1;
    },
    commit: async () => {},
    rollback: async () => {
      calls.rollbacks += 1;
    },
    release: () => {},
  };
  return { pool: { getConnection: async () => connection }, calls };
};

const handlerPayload = (units, over = {}) => ({
  companyId: 7,
  company: 'ABC Interpreting',
  units: validateImportBody({ units }).units,
  defaults: {},
  locationIds: { 'Miami, FL': 5 },
  skipped: [],
  ...over,
});

test('CADA unidad se escribe con SUS valores — el fallo que motivó el endpoint', async () => {
  const { pool, calls } = mockPool();
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async () => ({ location_id: 99 }),
    processSubLocationPath: async () => 1,
  });

  const result = await handler(
    handlerPayload([
      unit({ serial_number: 'A-1', cost: 258.42, location: 'Miami, FL' }),
      unit({ serial_number: 'A-2', cost: 235.56, location: 'Miami, FL' }),
    ])
  );

  assert.strictEqual(result.inserted, 2);
  const rows = calls.inserts[0];
  const costIndex = 2;
  const serialIndex = 6;
  assert.deepStrictEqual(rows.map((r) => r[serialIndex]), ['A-1', 'A-2']);
  // Aquí estaba el bug: con el endpoint viejo las dos filas llevaban 258.42.
  assert.deepStrictEqual(rows.map((r) => r[costIndex]), [258.42, 235.56]);
});

test('las locaciones que faltan se crean una vez cada una, no una por unidad', async () => {
  const { pool } = mockPool();
  const created = [];
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async (conn, data) => {
      created.push(data.location_name);
      return { location_id: 42 };
    },
    processSubLocationPath: async () => null,
  });

  const result = await handler(
    handlerPayload([
      unit({ serial_number: 'A-1', location: 'Tampa, FL' }),
      unit({ serial_number: 'A-2', location: 'Tampa, FL' }),
      unit({ serial_number: 'A-3', location: 'Miami, FL' }),
    ])
  );

  assert.deepStrictEqual(created, ['Tampa, FL']);
  assert.strictEqual(result.locationsCreated, 1);
  assert.strictEqual(result.inserted, 3);
});

test('la cadena de sub-locaciones se resuelve una vez por ruta distinta', async () => {
  const { pool } = mockPool();
  const paths = [];
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async () => ({ location_id: 5 }),
    processSubLocationPath: async (conn, locationId, segments) => {
      paths.push(segments.join('>'));
      return 77;
    },
  });

  await handler(
    handlerPayload([
      unit({ serial_number: 'A-1', sub_location: ['Section A', 'Locker 1'] }),
      unit({ serial_number: 'A-2', sub_location: ['Section A', 'Locker 1'] }),
      unit({ serial_number: 'A-3', sub_location: ['Section B'] }),
    ])
  );

  assert.deepStrictEqual(paths, ['Section A>Locker 1', 'Section B']);
});

test('un serial que la compañía ya tiene se salta y se reporta, no duplica la unidad', async () => {
  const { pool } = mockPool({ existingSerials: ['A-1'] });
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async () => ({ location_id: 5 }),
    processSubLocationPath: async () => null,
  });

  const result = await handler(
    handlerPayload([unit({ serial_number: 'A-1' }), unit({ serial_number: 'A-2' })])
  );

  assert.strictEqual(result.inserted, 1);
  assert.strictEqual(result.failedCount, 1);
  assert.strictEqual(result.failed[0].serial_number, 'A-1');
  assert.match(result.failed[0].reason, /already exists/);
});

test('el fallo del job lleva el `row` del cliente, no uno recalculado', async () => {
  const { pool } = mockPool({ existingSerials: ['A-2'] });
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async () => ({ location_id: 5 }),
    processSubLocationPath: async () => null,
  });

  const result = await handler(
    handlerPayload([
      unit({ row: 11, serial_number: 'A-1' }),
      unit({ row: 42, serial_number: 'A-2' }),
    ])
  );

  assert.strictEqual(result.failed[0].row, 42);
});

test('un lote que revienta se reintenta fila a fila: se salva todo menos la fila mala', async () => {
  // "El import falló" sobre 500 unidades no es accionable; el motivo por serial sí.
  const { pool, calls } = mockPool({ failSerials: ['A-2'] });
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async () => ({ location_id: 5 }),
    processSubLocationPath: async () => null,
  });

  const result = await handler(
    handlerPayload([
      unit({ serial_number: 'A-1' }),
      unit({ serial_number: 'A-2' }),
      unit({ serial_number: 'A-3' }),
    ])
  );

  assert.strictEqual(result.inserted, 2);
  assert.strictEqual(result.failedCount, 1);
  assert.strictEqual(result.failed[0].serial_number, 'A-2');
  assert.match(result.failed[0].reason, /Duplicate entry/);
  assert.strictEqual(calls.rollbacks, 2, 'el lote y solo la fila mala');
});

test('una sub-locación que no se puede crear tumba SUS unidades, no el import', async () => {
  const { pool } = mockPool();
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async () => ({ location_id: 5 }),
    processSubLocationPath: async (conn, locationId, segments) => {
      if (segments[0] === 'Rota') throw new Error('sub_locations: parent not found');
      return 7;
    },
  });

  const result = await handler(
    handlerPayload([
      unit({ serial_number: 'A-1', sub_location: ['Buena'] }),
      unit({ serial_number: 'A-2', sub_location: ['Rota'] }),
    ])
  );

  assert.strictEqual(result.inserted, 1);
  assert.strictEqual(result.failed[0].serial_number, 'A-2');
  assert.match(result.failed[0].reason, /sub-location could not be created/);
});

test('las filas repetidas del fichero llegan al resultado del job, en la MISMA lista', async () => {
  // El cliente enseña una lista, no dos: da igual si la fila se cayó al validar
  // o al insertar.
  const { pool } = mockPool();
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async () => ({ location_id: 5 }),
    processSubLocationPath: async () => null,
  });

  const result = await handler(
    handlerPayload([unit({ serial_number: 'A-1' })], {
      skipped: [{ serial_number: 'A-9', reason: 'duplicate serial number within the import' }],
    })
  );

  assert.strictEqual(result.inserted, 1);
  assert.strictEqual(result.failedCount, 1);
  assert.strictEqual(result.failed[0].serial_number, 'A-9');
});

test('el lote se trocea, y el troceo no pierde unidades', async () => {
  const { pool, calls } = mockPool();
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async () => ({ location_id: 5 }),
    processSubLocationPath: async () => null,
    batchSize: 2,
  });

  const units = Array.from({ length: 5 }, (_, i) => unit({ serial_number: `S-${i}` }));
  const result = await handler(handlerPayload(units));

  assert.deepStrictEqual(calls.inserts.map((rows) => rows.length), [2, 2, 1]);
  assert.strictEqual(result.inserted, 5);
});

test('sin unidades el job falla en vez de reportar un import vacío como exitoso', async () => {
  const { pool } = mockPool();
  const handler = createInventoryImportHandler({
    getConnection: () => pool,
    processLocation: async () => ({ location_id: 5 }),
    processSubLocationPath: async () => null,
  });
  await assert.rejects(() => handler({ companyId: 7, units: [] }), /no units provided/);
});

test('los fijos del import tienen respaldo en el servidor', () => {
  // Un import no puede depender de que el cliente se acuerde de mandar
  // display_item: sin él la unidad se da de alta invisible.
  const d = withDefaults({});
  assert.strictEqual(d.display_item, 1);
  assert.strictEqual(d.warehouse, 1);
  assert.strictEqual(d.enableAssignFeature, 1);
  assert.strictEqual(withDefaults({ display_item: 0 }).display_item, 0);
});

test('la fila tiene tantas columnas como la sentencia', () => {
  const columns = INSERT_QUERY.match(/\(([^)]+)\)\s*VALUES/)[1]
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const row = buildUnitRow(validateImportBody({ units: [unit()] }).units[0], {
    companyId: 7,
    company: 'ABC',
    locationId: 5,
    subLocationId: null,
    defaults: withDefaults({}),
    timestamp: '2026-09-22 10:00:00',
  });
  assert.strictEqual(row.length, columns.length);
});

test('distinctLocationNames respeta el orden del fichero', () => {
  const { units } = validateImportBody({
    units: [
      unit({ serial_number: 'A', location: 'Orlando, FL' }),
      unit({ serial_number: 'B', location: 'Miami, FL' }),
      unit({ serial_number: 'C', location: 'Orlando, FL' }),
    ],
  });
  assert.deepStrictEqual(distinctLocationNames(units), ['Orlando, FL', 'Miami, FL']);
});
