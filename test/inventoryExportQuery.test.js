'use strict';

/**
 * Las consultas del export (mysql/queries/inventoryExportQuery.js).
 *
 * Lo que de verdad protege este fichero es la invariante que el frontend pidió:
 * el export y la página comparten el WHERE, así que no pueden divergir. Si
 * alguien añade un filtro a `inventory-page` y no al export —o al revés— estas
 * pruebas lo cazan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPORT_COLUMNS,
  buildExportChunkQuery,
  buildExportCursor,
  buildEventLookupQuery,
  indexLatestAssignments,
} = require('../mysql/queries/inventoryExportQuery');
const {
  LIST_COLUMNS,
  buildBaseFilter,
  QueryParamError,
} = require('../mysql/queries/inventoryPageQuery');

test('el export proyecta los cinco campos que a la página le faltan', () => {
  // §4.1 del contrato: una hoja construida sobre las trece columnas de
  // inventory-page perdería en silencio el coste y la descripción.
  for (const column of ['cost', 'descript_item', 'extra_serial_number', 'return_date']) {
    assert.ok(EXPORT_COLUMNS.includes(column), `falta ${column}`);
    assert.ok(!LIST_COLUMNS.includes(column), `${column} ya no es exclusivo del export`);
  }
});

test('no arrastra las columnas pesadas que la hoja no usa', () => {
  // warehouse-items hace SELECT *; el export es una allowlist.
  assert.ok(!EXPORT_COLUMNS.includes('returnedRentedInfo'));
  assert.ok(!EXPORT_COLUMNS.includes('supplier_info'));
  assert.ok(!EXPORT_COLUMNS.includes('container_items'));
});

test('el WHERE es exactamente el de inventory-page', () => {
  const shared = {
    companyId: 7,
    filters: { brand: 'Dell', logistic_status: 'in-stock' },
    search: '00100',
    scope: { sql: 'location_id IN (?)', params: [3] },
  };

  const base = buildBaseFilter(shared);
  const query = buildExportChunkQuery(shared);

  // Misma cláusula y mismos parámetros: es la garantía de que lo exportado y
  // lo visto son el mismo conjunto.
  assert.ok(query.sql.includes(`WHERE ${base.sql}`));
  assert.deepEqual(query.params, base.params);
});

test('sin cursor no hay predicado de keyset y ordena por item_id', () => {
  const query = buildExportChunkQuery({ companyId: 7 });
  assert.match(query.sql, /ORDER BY item_id ASC LIMIT 1000$/);
  assert.deepEqual(query.params, [7]);
});

test('con cursor y orden secundario, desempata por item_id', () => {
  const query = buildExportChunkQuery({
    companyId: 7,
    sortBy: 'category_name',
    sortDir: 'desc',
    cursor: { v: 'Laptop', id: 42 },
  });

  assert.match(query.sql, /COALESCE\(`category_name`, ''\) DESC, item_id DESC/);
  assert.deepEqual(query.params, [7, 'Laptop', 'Laptop', 42]);
});

test('rechaza los mismos filtros y ordenaciones que la página', () => {
  // Un filtro inválido tiene que fallar en el 400 del controller, no dentro
  // del job media hora después.
  assert.throws(
    () => buildExportChunkQuery({ companyId: 7, filters: { descript_item: 'x' } }),
    QueryParamError
  );
  assert.throws(
    () => buildExportChunkQuery({ companyId: 7, sortBy: 'cost' }),
    QueryParamError
  );
});

test('exige contexto de compañía', () => {
  assert.throws(() => buildExportChunkQuery({}), QueryParamError);
});

test('el cursor sale de la última fila del trozo', () => {
  const rows = [{ item_id: 1, category_name: 'A' }, { item_id: 9, category_name: 'Z' }];

  assert.deepEqual(buildExportCursor(rows, { sortBy: null }), { id: 9 });
  assert.deepEqual(buildExportCursor(rows, { sortBy: 'category_name' }), { v: 'Z', id: 9 });
  assert.equal(buildExportCursor([], { sortBy: null }), null);
});

test('el lote de eventos parametriza los ids', () => {
  const lookup = buildEventLookupQuery([1, 2, 3]);

  // retrieveCompanyInventory (item.js:2559) los interpola en el texto del SQL;
  // aquí van como parámetros.
  assert.match(lookup.sql, /IN \(\?,\?,\?\)/);
  assert.deepEqual(lookup.params, [1, 2, 3]);
  assert.match(lookup.sql, /iiae\.active = 1/);
  assert.match(lookup.sql, /ORDER BY iiae\.event_id DESC/);
});

test('sin ids no se consulta nada', () => {
  // Un trozo entero en stock no debe costar una consulta que no cambia ni una celda.
  assert.equal(buildEventLookupQuery([]), null);
  assert.equal(buildEventLookupQuery(undefined), null);
});

test('de dos asignaciones activas gana la más reciente', () => {
  // La consulta llega ordenada por event_id DESC, así que la primera manda.
  // Un ítem en dos eventos a la vez existe, y la hoja tiene una sola celda.
  const byItem = indexLatestAssignments([
    { item_id: 5, event_name: 'NAB 2026', condition: 'Good' },
    { item_id: 5, event_name: 'IBC 2025', condition: 'Damaged' },
    { item_id: 6, event_name: null, condition: null },
  ]);

  assert.deepEqual(byItem.get(5), { event_name: 'NAB 2026', condition: 'Good' });
  assert.deepEqual(byItem.get(6), { event_name: null, condition: null });
  assert.equal(byItem.size, 2);
});
