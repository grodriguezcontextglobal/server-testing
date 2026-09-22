'use strict';

/**
 * Handler de la cola para deleteBulkItems (mysql/controllers/item.js): borrado
 * de inventario por LISTA DE IDS, la gemela de
 * queue/handlers/deleteBulkItemBasedOnCriteria.js (que borra por criterio).
 *
 * A diferencia de la gemela, el borrado real vive en el Go worker desde antes de
 * migrar a cola, así que este handler NO reimplementa el DELETE en SQL: mueve la
 * llamada tal cual, para no cambiar dos cosas a la vez.
 *
 * Lo que sí agrega es el troceo. `DeleteBulkItems` del lado Go
 * (go-worker/controllers.go) arma `DELETE FROM item_inv WHERE item_id IN (...)`
 * con un placeholder por id y sin límite; el SELECT de scope del controller ya
 * troceaba por esa misma razón (max_allowed_packet y el límite de parámetros),
 * pero el DELETE que se le mandaba a Go no. Una llamada por lote, y se suman
 * las filas afectadas.
 *
 * Reintento: el DELETE es idempotente (volver a borrar ids ya borrados afecta 0
 * filas), así que un reintento del job no corrompe nada. OJO con el conteo: si
 * el primer intento borró y el job se reintenta, el segundo reporta 0 —
 * `deletedCount` es "lo que borró ESTE intento", no el total histórico.
 */

const { chunkArray } = require("../../helpers/chunkArray");

/**
 * @param {Object} opts
 * @param {Function} opts.runGoWorker - helpers/goWorker.js (devuelve ya el `data` de la respuesta).
 * @param {number} [opts.batchSize=500] - ids por llamada al worker.
 */
function createDeleteBulkItemsByIdsHandler({ runGoWorker, batchSize = 500 }) {
  return async function deleteBulkItemsByIdsHandler(payload) {
    const { company_id, item_ids } = payload;

    if (!company_id) {
      throw new Error("company_id is required");
    }
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return { deletedCount: 0, batches: 0 };
    }

    let deletedCount = 0;
    let batches = 0;

    for (const batch of chunkArray(item_ids, batchSize)) {
      // runGoWorker ya desempaqueta `data` y lanza si el worker responde error.
      const data = await runGoWorker("delete-bulk-items", {
        company_id,
        item_ids: batch,
      });
      deletedCount += Number(data?.affectedRows ?? 0);
      batches += 1;
    }

    return { deletedCount, batches };
  };
}

module.exports = { createDeleteBulkItemsByIdsHandler };
