'use strict';

/**
 * Consultas del export de inventario en cola (`POST /api/db_item/inventory-export`).
 *
 * POR QUÉ NO REUTILIZA `buildPageQuery`: la hoja necesita DIECIOCHO campos y la
 * página proyecta TRECE. Le faltan cinco —`cost`, `descript_item`,
 * `extra_serial_number`, `return_date` y el `event_name` del evento activo— y
 * una hoja construida sobre la proyección de la página perdería en silencio el
 * coste de reposición y la descripción. Ver FRONTEND_inventory_export_contract_2026-09-17.md §4.1.
 *
 * LO QUE SÍ REUTILIZA, Y ES EL PUNTO: el WHERE sale de `buildBaseFilter` y el
 * orden de `normalizeSort`, los MISMOS de `inventory-page`. Es la razón por la
 * que el export vive aquí y no en el cliente: «lo que exporto» y «lo que veo»
 * no pueden divergir porque son literalmente el mismo constructor de filtro. Un
 * filtro que la página acepta, el export lo acepta; uno que rechaza, lo rechaza
 * con el mismo `QueryParamError`.
 *
 * Módulo puro: construye SQL y parámetros, no toca la conexión — igual que
 * `inventoryPageQuery.js`.
 */

const {
  buildBaseFilter,
  buildKeysetPredicate,
  normalizeSort,
  QueryParamError,
} = require('./inventoryPageQuery');

/**
 * Los dieciséis campos de `item_inv` que alimentan la hoja. Los otros dos
 * (`event_name` y `condition`) NO son columnas de `item_inv`: viven en
 * `event_info` e `item_inv_assigned_event` y se resuelven aparte, ver
 * `buildEventLookupQuery`.
 *
 * Es una allowlist explícita y no `SELECT *` a propósito. `warehouse-items`
 * —la ruta de la que estamos saliendo— hace `SELECT *` (`item.js:741`), y eso
 * arrastra las veintinueve columnas incluidas `returnedRentedInfo` y
 * `supplier_info`, que la hoja no usa y que son de las que peor comprimen.
 */
const EXPORT_COLUMNS = [
  'item_id',
  'serial_number',
  'warehouse',
  'location',
  'brand',
  'category_name',
  'item_group',
  'ownership',
  'cost',
  'status',
  'main_warehouse',
  'enableAssignFeature',
  'return_date',
  'extra_serial_number',
  'descript_item',
  'image_url',
];

/**
 * Filas por vuelta. El export no tiene `pageSize` —es el conjunto entero— pero
 * sí se lee a trozos: un inventario de 50.000 ítems materializado de golpe es
 * el mismo problema de memoria que tiene hoy el navegador, solo que movido al
 * worker. Con keyset, además, insertar inventario mientras el job corre no
 * salta filas (ver el razonamiento de `buildKeysetPredicate`).
 */
const EXPORT_CHUNK_SIZE = 1000;

/**
 * Un trozo del export: mismas condiciones que la página, sin `LIMIT` de
 * usuario y con la proyección completa.
 *
 * El `cursor` es el de `inventory-page` y se avanza con `buildExportCursor`.
 */
const buildExportChunkQuery = ({
  companyId,
  filters,
  search,
  scope,
  sortBy,
  sortDir,
  cursor,
  chunkSize = EXPORT_CHUNK_SIZE,
}) => {
  const sort = normalizeSort({ sortBy, sortDir });
  const base = buildBaseFilter({ companyId, filters, search, scope });
  const keyset = buildKeysetPredicate({ ...sort, cursor });

  const where = keyset.sql ? `${base.sql} AND ${keyset.sql}` : base.sql;
  const direction = sort.sortDir === 'desc' ? 'DESC' : 'ASC';
  const orderBy = sort.sortBy
    ? `COALESCE(\`${sort.sortBy}\`, '') ${direction}, item_id ${direction}`
    : `item_id ${direction}`;

  const limit = Number(chunkSize);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new QueryParamError('chunkSize must be a positive integer');
  }

  return {
    sql:
      `SELECT ${EXPORT_COLUMNS.map((column) => `\`${column}\``).join(', ')} ` +
      `FROM item_inv WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit}`,
    params: [...base.params, ...keyset.params],
    chunkSize: limit,
    sort,
  };
};

/** Cursor de la última fila del trozo, para pedir el siguiente. */
const buildExportCursor = (rows, sort) => {
  const last = rows[rows.length - 1];
  if (!last) return null;
  return sort.sortBy ? { v: last[sort.sortBy] ?? '', id: last.item_id } : { id: last.item_id };
};

/**
 * `event_name` y `condition` del evento ACTIVO, para un lote de item_ids.
 *
 * POR QUÉ UNA SEGUNDA CONSULTA Y NO UN JOIN: un ítem puede tener varias filas
 * en `item_inv_assigned_event`, así que un `LEFT JOIN` multiplicaría filas y el
 * export sacaría el mismo ítem dos veces. Además `status` e `item_id` existen
 * en las dos tablas, y con el JOIN el WHERE compartido con `inventory-page`
 * —que nombra las columnas sin prefijo— se volvería ambiguo. Un lote por trozo
 * mantiene la consulta principal idéntica a la de la página.
 *
 * Es el mismo patrón que ya usa `retrieveCompanyInventory` (`item.js:2559`),
 * con dos diferencias: los ids van PARAMETRIZADOS (allí se interpolan en el
 * texto del SQL) y se piden las dos columnas, no solo el nombre del evento.
 */
const buildEventLookupQuery = (itemIds) => {
  const ids = (itemIds || []).filter((id) => id !== undefined && id !== null);
  if (ids.length === 0) return null;

  const placeholders = ids.map(() => '?').join(',');
  return {
    sql:
      'SELECT iiae.item_id, iiae.`condition`, ei.event_name ' +
      'FROM item_inv_assigned_event iiae ' +
      'LEFT JOIN event_info ei ON ei.event_id = iiae.event_id ' +
      `WHERE iiae.active = 1 AND iiae.item_id IN (${placeholders}) ` +
      'ORDER BY iiae.event_id DESC',
    params: [...ids],
  };
};

/**
 * Indexa el resultado del lote por item_id quedándose con la asignación activa
 * MÁS RECIENTE.
 *
 * La consulta viene ordenada por `event_id DESC`, así que la primera fila de
 * cada ítem es la que gana y las siguientes se descartan. Un ítem asignado a
 * dos eventos activos a la vez existe en los datos; la hoja tiene una sola
 * celda, y elegir el más reciente es la misma regla que aplica hoy
 * `retrieveCompanyInventory` al quedarse con `usageMap.get(item_id)[0]`.
 */
const indexLatestAssignments = (rows) => {
  const byItem = new Map();
  for (const row of rows || []) {
    if (byItem.has(row.item_id)) continue;
    byItem.set(row.item_id, {
      event_name: row.event_name ?? null,
      condition: row.condition ?? null,
    });
  }
  return byItem;
};

module.exports = {
  EXPORT_COLUMNS,
  EXPORT_CHUNK_SIZE,
  buildExportChunkQuery,
  buildExportCursor,
  buildEventLookupQuery,
  indexLatestAssignments,
  QueryParamError,
};
