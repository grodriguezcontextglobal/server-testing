'use strict';

/**
 * Handler del import de hoja de cálculo (ver
 * mysql/controllers/inventoryImport.js y
 * FRONTEND_inventory_import_endpoint_2026-09-21.md).
 *
 * Una fila de `item_inv` por unidad, con los valores de ESA unidad. Es la
 * diferencia con `inventoryBulkInsert.js`, que copia los escalares del cuerpo
 * sobre todas las filas del lote — correcto cuando el lote son unidades
 * idénticas, y la razón por la que un fichero real escribía el coste de otra
 * fila en 482 de 500 unidades.
 *
 * TRANSACCIÓN POR LOTE, no por import. El frontend necesita poder enseñar «se
 * importaron 480 y estas 20 no, por esto» sobre 500 unidades; con una sola
 * transacción, una fila mala tira el fichero entero y la lista de fallos no
 * sirve de nada. Cuando un lote falla se reintenta fila a fila SOLO ese lote,
 * que es lo que convierte un error de MySQL en un motivo por serial.
 */

const {
  IMPORT_BATCH_SIZE,
  buildExistingSerialsQuery,
  buildLocationLookupQuery,
} = require('../../mysql/queries/inventoryImportQuery');

const INSERT_QUERY = `
  INSERT INTO item_inv (
    category_name, item_group, cost, brand, descript_item, ownership,
    serial_number, warehouse, main_warehouse, create_at, update_at,
    company, location, location_id, current_location, sub_location, sub_location_id,
    extra_serial_number, company_id, return_date, returnedRentedInfo, container,
    containerSpotLimit, container_id, display_item, enableAssignFeature, image_url,
    supplier_info
  ) VALUES ?`;

/**
 * Cuántos fallos se guardan en el resultado del job. El documento del job vive
 * en Mongo (16 MB por documento) y una lista de 10.000 motivos no la lee nadie:
 * se guardan los primeros y el total real aparte.
 */
const MAX_REPORTED_FAILURES = 500;

/** Lotes para el SELECT de seriales existentes — un IN de 10.000 no es sano. */
const LOOKUP_CHUNK = 500;

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/**
 * `returnedRentedInfo` y `container_id` son columnas JSON, y una cadena vacía NO
 * es JSON válido: MySQL responde `Invalid JSON text: "The document is empty."` y
 * rechaza la fila.
 *
 * Esto tumbó el primer import real en produccion -- 581 de 581 filas -- porque el
 * cliente manda `"returnedRentedInfo": ""` en sus `defaults` y aquí se respetaba
 * tal cual. `inventoryBulkInsert.js` nunca se topó con ello porque IGNORA el
 * payload y hardcodea `'[]'`; al hacer configurable lo que allí era fijo, el
 * valor del cliente llegó por primera vez hasta la columna.
 *
 * Vacío y nulo caen al array vacío. Un JSON inválido de verdad se deja pasar a
 * MySQL a propósito: reescribirlo en silencio escondería un fallo del cliente, y
 * el rechazo ya sale por fila con su motivo.
 */
const asJsonText = (value, fallback = '[]') => {
  if (value === undefined || value === null || value === '') return fallback;
  return typeof value === 'string' ? value : JSON.stringify(value);
};

/**
 * Los valores fijos del import. Vienen del cuerpo (`defaults`) porque son los
 * mismos que el cliente manda hoy en cada petición del endpoint viejo, pero con
 * respaldo aquí: un import no puede depender de que el cliente se acuerde de
 * mandar `display_item`.
 */
const withDefaults = (defaults = {}) => ({
  warehouse: defaults.warehouse === undefined ? 1 : defaults.warehouse,
  display_item: defaults.display_item === undefined ? 1 : defaults.display_item,
  enableAssignFeature:
    defaults.enableAssignFeature === undefined ? 1 : defaults.enableAssignFeature,
  container: defaults.container === undefined ? 0 : defaults.container,
  containerSpotLimit:
    defaults.containerSpotLimit === undefined ? null : defaults.containerSpotLimit,
  containerId: asJsonText(defaults.containerId),
  returnedRentedInfo: asJsonText(defaults.returnedRentedInfo),
  return_date: defaults.return_date === undefined ? null : defaults.return_date,
  supplier_info: defaults.supplier_info === undefined ? '' : defaults.supplier_info,
});

/**
 * Fila de `item_inv` a partir de UNA unidad. Aquí no hay ningún escalar
 * compartido: todo sale de `unit`, salvo los fijos del import.
 */
function buildUnitRow(unit, { companyId, company, locationId, subLocationId, defaults, timestamp }) {
  const d = defaults;
  return [
    unit.category_name,
    unit.item_group,
    unit.cost,
    unit.brand,
    unit.descript_item,
    unit.ownership,
    unit.serial_number,
    d.warehouse,
    unit.main_warehouse,
    timestamp,
    timestamp,
    company || null,
    unit.location_name,
    locationId,
    // `current_location` refleja la locación en el alta, que es lo que el
    // cliente venía mandando ("mirrors location"). Deja de reflejarla en cuanto
    // la unidad se asigna a un evento, y de eso ya se encarga esa ruta.
    unit.location_name,
    unit.sub_location_segments && unit.sub_location_segments.length
      ? JSON.stringify(unit.sub_location_segments)
      : null,
    subLocationId,
    unit.extra_serial_number,
    companyId,
    d.return_date,
    d.returnedRentedInfo,
    d.container,
    d.containerSpotLimit,
    d.containerId,
    d.display_item,
    d.enableAssignFeature,
    unit.image_url,
    unit.supplier_info || d.supplier_info,
  ];
}

/**
 * @param {Object} opts
 * @param {Function} opts.getConnection - devuelve el Pool (mysql/database/config.js)
 * @param {Function} opts.processLocation - find-or-create de locación
 * @param {Function} opts.processSubLocationPath - resuelve/crea la cadena de sub-locaciones
 * @param {number} [opts.batchSize]
 */
function createInventoryImportHandler({
  getConnection,
  processLocation,
  processSubLocationPath,
  batchSize = IMPORT_BATCH_SIZE,
}) {
  return async function inventoryImportHandler(payload) {
    const { companyId, company, units, defaults, locationIds = {}, skipped = [] } = payload;
    if (!Array.isArray(units) || units.length === 0) {
      throw new Error('no units provided');
    }

    const resolvedDefaults = withDefaults(defaults);
    const timestamp = nowSql();
    const failures = [...skipped];
    const pool = getConnection();
    const connection = await pool.getConnection();

    let inserted = 0;
    let locationsCreated = 0;

    try {
      // ── 1. Locaciones ──────────────────────────────────────────────────
      // Las que el controller no encontró se crean AQUÍ, una vez cada una. El
      // cliente lo hacía con una llamada por locación antes de importar, y esas
      // llamadas gastaban del mismo presupuesto de peticiones que el import.
      const locationIdByName = new Map(Object.entries(locationIds).map(([k, v]) => [k, Number(v)]));
      const unresolved = [...new Set(units.map((u) => u.location_name))].filter(
        (name) => !locationIdByName.has(name)
      );

      if (unresolved.length > 0) {
        // Se vuelven a buscar antes de crear: `processLocation` es find-or-create y
        // no dice cuál de las dos hizo, así que contar sus llamadas daba por
        // "creadas" locaciones que ya existían. El numero lo lee una persona para
        // decidir si el fichero traia locaciones nuevas de verdad.
        const lookup = buildLocationLookupQuery(companyId, unresolved);
        const [existing] = await connection.execute(lookup.sql, lookup.params);
        for (const row of existing) {
          locationIdByName.set(row.location_name, Number(row.location_id));
        }

        for (const name of unresolved) {
          if (locationIdByName.has(name)) continue;
          const created = await processLocation(connection, {
            company_id: companyId,
            location_name: name,
          });
          locationIdByName.set(name, Number(created.location_id));
          locationsCreated += 1;
        }
      }

      // ── 2. Sub-locaciones ──────────────────────────────────────────────
      // Una vez por cadena distinta, no una por unidad: en el fichero medido
      // hay 12-15 sub-locaciones por grupo y 500 unidades. Si una cadena no se
      // puede crear, caen sus unidades y no el import.
      const subLocationIdByKey = new Map();
      const brokenPaths = new Map();
      for (const unit of units) {
        if (!unit.sub_location_segments || unit.sub_location_segments.length === 0) continue;
        const locationId = locationIdByName.get(unit.location_name);
        const key = `${locationId}::${unit.sub_location_segments.join('>')}`;
        if (subLocationIdByKey.has(key) || brokenPaths.has(key)) continue;
        try {
          const subLocationId = await processSubLocationPath(
            connection,
            locationId,
            unit.sub_location_segments,
            companyId
          );
          subLocationIdByKey.set(key, subLocationId || null);
        } catch (error) {
          brokenPaths.set(key, error.message);
        }
      }

      // ── 3. Seriales que la compañía ya tiene ───────────────────────────
      const existing = new Set();
      for (const part of chunk(units.map((u) => u.serial_number), LOOKUP_CHUNK)) {
        const lookup = buildExistingSerialsQuery(companyId, part);
        const [rows] = await connection.execute(lookup.sql, lookup.params);
        for (const row of rows) existing.add(String(row.serial_number).toLowerCase());
      }

      // ── 4. Qué se inserta y qué no ─────────────────────────────────────
      const insertable = [];
      for (const unit of units) {
        if (existing.has(unit.serial_number.toLowerCase())) {
          failures.push({
            serial_number: unit.serial_number,
            row: unit.row,
            reason: 'serial number already exists in this company',
          });
          continue;
        }
        const locationId = locationIdByName.get(unit.location_name);
        const key = `${locationId}::${(unit.sub_location_segments || []).join('>')}`;
        if (brokenPaths.has(key)) {
          failures.push({
            serial_number: unit.serial_number,
            row: unit.row,
            reason: `sub-location could not be created: ${brokenPaths.get(key)}`,
          });
          continue;
        }
        insertable.push({
          unit,
          row: buildUnitRow(unit, {
            companyId,
            company,
            locationId,
            subLocationId: subLocationIdByKey.get(key) || null,
            defaults: resolvedDefaults,
            timestamp,
          }),
        });
      }

      // ── 5. Inserción por lotes ─────────────────────────────────────────
      for (const batch of chunk(insertable, batchSize)) {
        try {
          await connection.beginTransaction();
          const [result] = await connection.query(INSERT_QUERY, [batch.map((b) => b.row)]);
          await connection.commit();
          inserted += result.affectedRows;
        } catch (error) {
          await connection.rollback();
          // El lote no dice QUÉ fila lo rompió, y "el import falló" sobre 500
          // unidades no es accionable. Se reintenta fila a fila solo este lote:
          // cuesta N sentencias, pero únicamente cuando algo va mal.
          for (const entry of batch) {
            try {
              await connection.beginTransaction();
              const [one] = await connection.query(INSERT_QUERY, [[entry.row]]);
              await connection.commit();
              inserted += one.affectedRows;
            } catch (rowError) {
              await connection.rollback();
              failures.push({
                serial_number: entry.unit.serial_number,
                row: entry.unit.row,
                reason: rowError.message,
              });
            }
          }
        }
      }
    } finally {
      connection.release();
    }

    return {
      inserted,
      total: units.length,
      locationsCreated,
      failedCount: failures.length,
      failed: failures.slice(0, MAX_REPORTED_FAILURES),
      failedTruncated: failures.length > MAX_REPORTED_FAILURES,
    };
  };
}

module.exports = {
  createInventoryImportHandler,
  buildUnitRow,
  withDefaults,
  asJsonText,
  INSERT_QUERY,
  MAX_REPORTED_FAILURES,
};
