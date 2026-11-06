'use strict';

/**
 * Handler de la cola para la carga masiva de inventario en formato
 * alfanumérico (hasta ~15,000 seriales por job — ver
 * controller/item.js § insertBulkItemAlhpanumericFormat y
 * DESIGN_task_queue.md § Fase 4b).
 *
 * Extraído de insertBulkItemAlhpanumericFormatWorker (antes vivía inline en
 * mysql/controllers/item.js y corría dentro del ciclo request/response). El
 * bug original: `connection = getConnection()` es el Pool, no una
 * PoolConnection — cada batch de 1000 se autocommiteaba independiente (sin
 * transacción real), así que un fallo a mitad de carga dejaba inventario
 * parcial sin rollback. Aquí se saca una conexión dedicada del pool y TODOS
 * los batches corren dentro de una sola transacción.
 */

const planLimits = require('../../helpers/planLimits');

const INSERT_QUERY = `
  INSERT INTO item_inv (
    category_name, item_group, cost, brand, descript_item, ownership,
    serial_number, warehouse, main_warehouse, create_at, update_at,
    company, location, location_id, current_location, sub_location, extra_serial_number,
    company_id, return_date, returnedRentedInfo, container, containerSpotLimit,
    container_id, display_item, enableAssignFeature, image_url, supplier_info
  ) VALUES ?`;

/**
 * extra_serial_number llega como JSON string de un array de objetos
 * {serial: extraInfo} (uno por cada serial que tiene info adicional, no todos
 * la tienen). Se aplana a un mapa serial -> extraInfo para lookup O(1) por fila.
 */
function buildExtraInfoMap(extraSerialNumber) {
  if (!extraSerialNumber || typeof extraSerialNumber !== 'string') return {};
  try {
    const parsed = JSON.parse(extraSerialNumber);
    if (!Array.isArray(parsed)) {
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    }
    return parsed.reduce((acc, item) => {
      if (item) {
        const key = Object.keys(item)[0];
        if (key) acc[key] = item[key];
      }
      return acc;
    }, {});
  } catch (e) {
    return {};
  }
}

function buildBatchValues(batch, payload, extraInfoMap) {
  const {
    category_name, item_group, cost, brand, descript_item, ownership,
    warehouse, main_warehouse, created_at, update_at, company, location,
    location_id, current_location, sub_location, company_id, return_date,
    container, containerSpotLimit, image_url, supplier_info,
  } = payload;

  const returnedRentedInfo = '[]';
  const containerID = '[]';
  const displayItem = 1;
  const enableAssignFeature = 1;

  return batch.map((serial) => [
    category_name, item_group, cost, brand, descript_item, ownership,
    serial, warehouse, main_warehouse, created_at, update_at, company,
    location, location_id, current_location, sub_location,
    extraInfoMap[serial] ? JSON.stringify(extraInfoMap[serial]) : null,
    company_id, return_date, returnedRentedInfo, container, containerSpotLimit,
    containerID, displayItem, enableAssignFeature, image_url, supplier_info,
  ]);
}

/**
 * @param {Object} opts
 * @param {Function} opts.getConnection - mysql/database/config.js (devuelve el Pool).
 * @param {number} [opts.batchSize=1000]
 */
function createInventoryBulkInsertHandler({
  getConnection,
  batchSize = 1000,
  withPlanCapacity = planLimits.withPlanCapacity,
}) {
  return async function inventoryBulkInsertHandler(payload, job) {
    const { list } = payload;
    if (!list || list.length === 0) {
      throw new Error('no serial numbers provided');
    }

    const extraInfoMap = buildExtraInfoMap(payload.extra_serial_number);

    // Tope del plan (2026-11-06): todo o nada, bajo el candado de la compañía.
    // El rechazo es el resultado del job, no un error (no se reintenta).
    const capacity = await withPlanCapacity(
      {
        resource: 'items',
        sqlCompanyId: payload.company_id,
        requested: list.length,
        context: planLimits.planContextFromJob(job, 'inventory:bulk-insert-alphanumeric'),
        lockOptions: planLimits.BULK_LOCK_OPTIONS,
      },
      async () => {
        const pool = getConnection();
        const connection = await pool.getConnection();
        let inserted = 0;

        try {
          await connection.beginTransaction();

          for (let i = 0; i < list.length; i += batchSize) {
            const batch = list.slice(i, i + batchSize);
            const values = buildBatchValues(batch, payload, extraInfoMap);
            const [result] = await connection.query(INSERT_QUERY, [values]);
            inserted += result.affectedRows;
          }

          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }

        return { inserted, total: list.length };
      }
    );
    return capacity.refusal || capacity.result;
  };
}

module.exports = { createInventoryBulkInsertHandler, buildExtraInfoMap, buildBatchValues, INSERT_QUERY };
