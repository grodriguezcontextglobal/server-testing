'use strict';

/**
 * Handler de la cola para deleteBulkItemBasedOnCriteria (mysql/controllers/item.js):
 * un delete por criterio -- si no se manda serial_number, borra TODA una
 * categoría/ubicación del inventario, sin techo natural (ver
 * project_bulk_queue_migration_plan.md). El controller resuelve el scope
 * (company_id/category_name/item_group + location_ids si el rol es
 * location-scoped) y encola; este handler arma el WHERE y corre el DELETE,
 * en batches por serial_number cuando aplica, dentro de UNA transacción con
 * conexión dedicada del pool -- misma lógica que ya estaba antes de migrar,
 * solo movida aquí.
 */

const { chunkArray } = require("../../helpers/chunkArray");

/**
 * @param {Object} opts
 * @param {Function} opts.getConnection - mysql/database/config.js (devuelve el Pool).
 * @param {number} [opts.batchSize=500]
 */
function createDeleteBulkItemBasedOnCriteriaHandler({ getConnection, batchSize = 500 }) {
  return async function deleteBulkItemBasedOnCriteriaHandler(payload) {
    const { company_id, category_name, item_group, serial_number, location_ids } = payload;

    const baseWhereClauses = ["company_id = ?", "category_name = ?"];
    const baseValues = [company_id, category_name];
    if (Array.isArray(location_ids) && location_ids.length > 0) {
      const locPlaceholders = location_ids.map(() => "?").join(",");
      baseWhereClauses.push(`location_id IN (${locPlaceholders})`);
      baseValues.push(...location_ids);
    }
    if (item_group) {
      baseWhereClauses.push("item_group = ?");
      baseValues.push(item_group);
    }

    // A serial_number list is the one criterion that can be genuinely large
    // (a specific set of units to remove) -- an unbounded IN (...) for all of
    // them risks max_allowed_packet/parameter limits. Run one DELETE per
    // serial-number batch, sharing the same transaction, and sum the counts.
    const hasSerialFilter =
      serial_number && Array.isArray(serial_number) && serial_number.length > 0;
    const serialBatches = hasSerialFilter ? chunkArray(serial_number, batchSize) : [null];

    const pool = getConnection();
    const connection = await pool.getConnection();
    let deletedCount = 0;

    try {
      await connection.beginTransaction();
      for (const serialBatch of serialBatches) {
        const whereClauses = [...baseWhereClauses];
        const values = [...baseValues];
        if (serialBatch) {
          const serialPlaceholders = serialBatch.map(() => "?").join(",");
          whereClauses.push(`serial_number IN (${serialPlaceholders})`);
          values.push(...serialBatch);
        }
        const query = `DELETE FROM item_inv WHERE ${whereClauses.join(" AND ")}`;
        const [result] = await connection.execute(query, values);
        deletedCount += result.affectedRows;
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return { deletedCount };
  };
}

module.exports = { createDeleteBulkItemBasedOnCriteriaHandler };
