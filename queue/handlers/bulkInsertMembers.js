'use strict';

/**
 * Handler de la cola para insertBulkMembers (mysql/controllers/members.js):
 * import de estudiantes/miembros vía CSV -- un import a nivel de distrito
 * escolar puede ser miles de filas (ver
 * project_bulk_queue_migration_plan.md). El controller normaliza las filas
 * y resuelve las columnas reales de la tabla (rápido, sin escritura) y
 * encola; este handler hace el INSERT real, en batches dentro de UNA
 * transacción con conexión dedicada del pool -- misma lógica que ya estaba
 * en insertBulkMembers antes de migrar, solo movida aquí.
 */

const { chunkArray } = require("../../helpers/chunkArray");

/**
 * @param {Object} opts
 * @param {Function} opts.getConnection - mysql/database/config.js (devuelve el Pool).
 * @param {number} [opts.batchSize=500]
 */
function createBulkInsertMembersHandler({ getConnection, batchSize = 500 }) {
  return async function bulkInsertMembersHandler(payload) {
    const { valid, columns } = payload;
    if (!Array.isArray(valid) || valid.length === 0) {
      throw new Error("No valid rows provided.");
    }
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new Error("No columns resolved for insert.");
    }

    const rowPlaceholders = `(${columns.map(() => "?").join(", ")})`;
    const query = `INSERT INTO members_info (${columns.join(", ")}) VALUES `;

    const pool = getConnection();
    const connection = await pool.getConnection();
    let affectedRows = 0;
    let insertId = null;

    try {
      await connection.beginTransaction();
      for (const batch of chunkArray(valid, batchSize)) {
        const batchValues = [];
        for (const r of batch) {
          for (const c of columns) batchValues.push(r[c] !== undefined ? r[c] : null);
        }
        const batchQuery = query + batch.map(() => rowPlaceholders).join(", ");
        const [result] = await connection.query(batchQuery, batchValues);
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

    return { affectedRows, insertId };
  };
}

module.exports = { createBulkInsertMembersHandler };
