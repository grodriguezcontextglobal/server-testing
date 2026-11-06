'use strict';

/**
 * Handler de la cola para insertBulkItem (mysql/controllers/item.js): un
 * rango min/max de número de serie que el SERVIDOR expande a filas -- sin
 * techo natural (a diferencia de una lista explícita del cliente, ver
 * DESIGN de project_bulk_queue_migration_plan.md). El controller solo
 * resuelve location_id/valida scope (rápido) y encola; este handler genera
 * los seriales y hace el INSERT real, en batches dentro de una única
 * transacción con conexión dedicada del pool -- misma lógica que ya estaba
 * en insertBulkItem antes de migrar, solo movida aquí.
 */

const { chunkArray } = require("../../helpers/chunkArray");
const planLimits = require("../../helpers/planLimits");

const INSERT_QUERY = `
  INSERT INTO item_inv (
    category_name, sub_category_name, item_group, sub_item_group, cost, brand,
    descript_item, ownership, serial_number, warehouse, main_warehouse,
    create_at, update_at, company, location, location_id, current_location,
    sub_location, extra_serial_number, company_id, return_date,
    returnedRentedInfo, container, containerSpotLimit, container_id,
    display_item, enableAssignFeature, image_url, supplier_info
  ) VALUES ?`;

function generateSerialNumbers(minSerialNumber, maxSerialNumber) {
  const serials = [];
  let current = parseInt(minSerialNumber, 10);
  const max = parseInt(maxSerialNumber, 10);
  while (current <= max) {
    serials.push(current.toString().padStart(String(minSerialNumber).length, "0"));
    current++;
  }
  return serials;
}

function buildRowValues(payload, serialNumbers) {
  const {
    category_name, sub_category_name, item_group, sub_item_group, cost, brand,
    descript_item, ownership, warehouse, main_warehouse, created_at, update_at,
    company, location, location_id, current_location, sub_location,
    extra_serial_number, company_id, return_date, returnedRentedInfo, container,
    containerSpotLimit, containerId, display_item, enableAssignFeature,
    image_url, supplier_info,
  } = payload;

  return serialNumbers.map((serial_number) => [
    category_name, sub_category_name || null, item_group, sub_item_group || null,
    cost, brand, descript_item, ownership, serial_number, warehouse, main_warehouse,
    created_at, update_at, company, location, location_id, current_location,
    sub_location, extra_serial_number, company_id, return_date, returnedRentedInfo,
    container, containerSpotLimit, containerId, display_item, enableAssignFeature,
    image_url || null, supplier_info,
  ]);
}

/**
 * @param {Object} opts
 * @param {Function} opts.getConnection - mysql/database/config.js (devuelve el Pool).
 * @param {number} [opts.batchSize=500]
 */
function createBulkInsertItemRangeHandler({
  getConnection,
  batchSize = 500,
  withPlanCapacity = planLimits.withPlanCapacity,
}) {
  return async function bulkInsertItemRangeHandler(payload, job) {
    const serialNumbers = generateSerialNumbers(payload.min_serial_number, payload.max_serial_number);
    if (serialNumbers.length === 0) {
      throw new Error("No serial numbers generated.");
    }
    const values = buildRowValues(payload, serialNumbers);

    // Tope del plan (2026-11-06): todo o nada, bajo el candado de la compañía.
    // Un rechazo es el RESULTADO del job (no un error): reintentarlo no cambia
    // nada, y el controlador lo convierte en 403.
    const capacity = await withPlanCapacity(
      {
        resource: "items",
        sqlCompanyId: payload.company_id,
        requested: serialNumbers.length,
        context: planLimits.planContextFromJob(job, "inventory:bulk-insert-range"),
        lockOptions: planLimits.BULK_LOCK_OPTIONS,
      },
      async () => {
        const pool = getConnection();
        const connection = await pool.getConnection();
        let affectedRows = 0;
        let insertId = null;

        try {
          await connection.beginTransaction();
          for (const batch of chunkArray(values, batchSize)) {
            const [result] = await connection.query(INSERT_QUERY, [batch]);
            affectedRows += result.affectedRows || 0;
            if (insertId === null) insertId = result.insertId || null;
          }
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
        return { affectedRows, insertId, total: serialNumbers.length };
      }
    );
    return capacity.refusal || capacity.result;
  };
}

module.exports = {
  createBulkInsertItemRangeHandler,
  generateSerialNumbers,
  buildRowValues,
  INSERT_QUERY,
};
