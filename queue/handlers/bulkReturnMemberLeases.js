'use strict';

/**
 * Handler de la cola para bulkReturnMemberLeases (mysql/controllers/members.js):
 * fin de trimestre / recolección masiva de leases -- si no se manda
 * member_ids/grade, toca TODOS los leases pendientes de la compañía (sin
 * techo natural, ver project_bulk_queue_migration_plan.md). El controller
 * resuelve la lista de leases en scope (lectura rápida) y encola; este
 * handler hace las 2 escrituras (marcar leases devueltos + reponer
 * inventario) en batches dentro de UNA transacción con conexión dedicada
 * del pool -- misma lógica que ya estaba en bulkReturnMemberLeases antes de
 * migrar, solo movida aquí.
 */

const { chunkArray } = require("../../helpers/chunkArray");

/**
 * @param {Object} opts
 * @param {Function} opts.getConnection - mysql/database/config.js (devuelve el Pool).
 * @param {number} [opts.batchSize=500]
 */
function createBulkReturnMemberLeasesHandler({ getConnection, batchSize = 500 }) {
  return async function bulkReturnMemberLeasesHandler(payload) {
    const { company_id, return_status, condition_note, leases } = payload;
    if (!Array.isArray(leases) || leases.length === 0) {
      throw new Error("No leases provided.");
    }

    const pool = getConnection();
    const connection = await pool.getConnection();
    let devicesRestocked = 0;

    try {
      await connection.beginTransaction();

      for (const batch of chunkArray(leases, batchSize)) {
        const leaseKeyClause = batch
          .map(() => "(company_id = ? AND member_id = ? AND device_id = ? AND returned = 0)")
          .join(" OR ");
        const leaseKeyValues = batch.flatMap((l) => [
          String(l.company_id),
          l.member_id,
          l.device_id,
        ]);
        await connection.query(
          `UPDATE member_assigned_device_lease
           SET returned = 1, return_status = ?, condition_note = ?, returned_date = NOW()
           WHERE ${leaseKeyClause}`,
          [return_status, condition_note, ...leaseKeyValues]
        );
      }

      // Physical devices come back for 'returned'/'damaged'; 'lost' stays out.
      if (return_status !== "lost") {
        const deviceIds = [...new Set(leases.map((l) => l.device_id).filter(Boolean))];
        for (const batch of chunkArray(deviceIds, batchSize)) {
          const [res] = await connection.query(
            `UPDATE item_inv SET warehouse = 1, logistic_status = 'in-stock', \`update_at\` = NOW()
             WHERE company_id = ? AND item_id IN (${batch.map(() => "?").join(",")})`,
            [String(company_id), ...batch]
          );
          devicesRestocked += res.affectedRows || 0;
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return { returned: leases.length, devicesRestocked, return_status };
  };
}

module.exports = { createBulkReturnMemberLeasesHandler };
