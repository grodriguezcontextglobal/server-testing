require("dotenv").config();
const logger = require("../../helpers/logger");
const getConnection = require("../database/config");
const { groupBy } = require("lodash");
const connection = getConnection();
const { getStaffCompanyAccess, buildInventoryScopeFilter } = require("../helpers/staffAccess");

const runGoWorker = require("../../helpers/goWorker");
const { createQueuedJobController } = require("../../helpers/queuedController");
const { resolveEventItemShippingUpdatePlan } = require("../../queue/handlers/eventItemShippingBulkUpdate");
const { performUpdateLargeData, ITEM_INV_COLUMNS } = require("./item");
const {
  poolReceiversBulk: poolReceiversBulkWorker,
} = require("../../controller/receiverWorker");
// Pure "do the work" function — no req/res — so internal callers (ex.
// allocateDeviceToEvent below) can call it directly instead of invoking the
// Express handler with a borrowed `response` object.
async function performInsertingItemInEvent({ event_id, item_group, category_name, company_id, data } = {}, { runGoWorkerFn = runGoWorker } = {}) {
  if (
    !event_id ||
    !item_group ||
    !category_name ||
    !company_id ||
    !Array.isArray(data) ||
    data.length === 0
  ) {
    const err = new Error("Missing required fields or invalid data format");
    err.statusCode = 400;
    throw err;
  }

  // Convert data to string array as Go worker expects
  const serialNumbers = data.map((item) => item.toString());

  // Offload to Go Worker
  return runGoWorkerFn("insert-item-event", {
    category_name,
    company_id: String(company_id),
    data: serialNumbers,
    event_id: String(event_id),
    item_group,
  });
}

function createInsertingItemInEvent({ runGoWorkerFn = runGoWorker } = {}) {
  return async function insertingItemInEvent(request, response) {
    try {
      const result = await performInsertingItemInEvent(request.body, { runGoWorkerFn });
      response.status(201).json({
        inserted_items: result.inserted_items,
        msg: "Items inserted successfully into event",
        ok: true,
        total_items: result.total_items,
      });
    } catch (error) {
      logger.error("Error:", error.message);
      response.status(error.statusCode || 500).json({ msg: error.message, ok: false });
    }
  };
}
const insertingItemInEvent = createInsertingItemInEvent();

// Migrado al contrato async (202 + jobId, ver DESIGN_task_queue.md § Fase 4b):
// el UPDATE corría síncrono sosteniendo la conexión HTTP. El controller solo
// valida (sin DB) y encola; el UPDATE real vive en
// queue/handlers/eventItemShippingBulkUpdate.js.
const bulkUpdateEventItemShipping = createQueuedJobController(
  "event:bulk-update-item-shipping",
  (body) => body,
  {
    validate: (body) => {
      const plan = resolveEventItemShippingUpdatePlan(body);
      return plan.error ? { status: plan.error.status, body: { message: plan.error.msg, ok: false } } : null;
    },
    buildSuccessBody: (job) => ({
      message: "Event item shipping bulk update queued",
      ok: true,
      jobId: job.id,
    }),
  },
);

const removeEventItemShipping = async (request, response) => {
  let connection;
  try {
    const { event_id, items } = request.body;

    if (!event_id || !Array.isArray(items) || items.length === 0) {
      return response.status(400).json({
        message: "event_id and a non-empty array of item IDs are required.",
        ok: false,
      });
    }

    connection = await getConnection().getConnection();
    await connection.beginTransaction();

    const query = `
      DELETE FROM event_item_shipping
      WHERE event_id = ? AND item_id IN (?);
    `;

    const [result] = await connection.query(query, [event_id, items]);

    await connection.commit();

    if (result.affectedRows === 0) {
      return response.status(404).json({
        message: "No matching items found for the given event to remove.",
        ok: false,
      });
    }

    return response.status(200).json({
      message: `${result.affectedRows} item(s) have been removed from the event shipping list.`,
      ok: true,
      total_removed: result.affectedRows,
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    logger.error("Error removing event items:", error.message);
    return response.status(500).json({
      error: error.message || "An internal error occurred while removing items.",
      ok: false,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const getEventItemShipping = async (request, response) => {
  let connection;
  try {
    const { company_id, ...filters } = request.body;

    if (!company_id) {
      return response.status(400).json({
        message: "company_id is a required field.",
        ok: false,
      });
    }

    connection = await getConnection().getConnection();

    const allowedFilters = ["event_id", "item_id", "shipping_status", "active"];
    const filterKeys = Object.keys(filters).filter(key => allowedFilters.includes(key));

    // Use eis alias for clarity and to prevent ambiguity
    let whereClause = "WHERE eis.company_id = ?";
    const queryValues = [company_id];

    if (filterKeys.length > 0) {
      const filterConditions = filterKeys.map(key => {
        const value = filters[key];
        if (Array.isArray(value)) {
          queryValues.push(...value);
          // Use eis alias in filter
          return `eis.${key} IN (${value.map(() => '?').join(',')})`;
        } else {
          queryValues.push(value);
          // Use eis alias in filter
          return `eis.${key} = ?`;
        }
      }).join(" AND ");
      whereClause += ` AND ${filterConditions}`;
    }

    const query = `
      SELECT 
        eis.*, 
        ii.*,
        ei.event_name, 
        CONCAT_WS(', ', ei.street_address, ei.city_address, ei.state_address, ei.zip_address) as event_address
      FROM event_item_shipping eis
      LEFT JOIN item_inv ii ON eis.item_id = ii.item_id
      LEFT JOIN event_info ei ON eis.event_id = ei.event_id
      ${whereClause};
    `;

    const [rows] = await connection.query(query, queryValues);

    return response.status(200).json({
      items: rows,
      ok: true,
    });

  } catch (error) {
    logger.error("Error retrieving event item shipping data:", error.message);
    return response.status(500).json({
      error: error.message || "An internal error occurred while retrieving data.",
      ok: false,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const updateEventItemShipping = async (request, response) => {
  let connection;
  try {
    const { company_id, event_id, items, updates } = request.body;
    const CHUNK_SIZE = 1000;

    if (!company_id || !event_id || !Array.isArray(items) || items.length === 0) {
      return response.status(400).json({
        message: "company_id, event_id, and a non-empty array of item IDs are required.",
        ok: false,
      });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return response.status(400).json({
        message: "At least one update field must be provided.",
        ok: false,
      });
    }

    const allowedUpdates = ["shipping_status", "active", "notes"];
    const fieldsToUpdate = Object.keys(updates);
    const invalidFields = fieldsToUpdate.filter(field => !allowedUpdates.includes(field));

    if (invalidFields.length > 0) {
      return response.status(400).json({
        message: `Invalid fields for update: ${invalidFields.join(", ")}`,
        ok: false,
      });
    }

    connection = await getConnection().getConnection();
    await connection.beginTransaction();

    const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(", ");
    const updateValues = fieldsToUpdate.map(field => updates[field]);

    let totalAffectedRows = 0;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);

      const query = `
        UPDATE event_item_shipping
        SET ${setClause}
        WHERE event_id = ? AND company_id = ? AND item_id IN (?);
      `;

      const [result] = await connection.query(query, [...updateValues, event_id, company_id, chunk]);
      totalAffectedRows += result.affectedRows;
    }

    await connection.commit();

    return response.status(200).json({
      message: `${totalAffectedRows} item(s) have been updated for event ${event_id}.`,
      ok: true,
      total_updated: totalAffectedRows,
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    logger.error("Error updating event items:", error.message);
    return response.status(500).json({
      error: error.message || "An internal error occurred while updating items.",
      ok: false,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const insertingDeviceInEventDirectly = async (request, response) => {
  try {
    const { item_id, event_id } = request.body;

    // Offload to Go Worker (via HTTP, no process spawning per request)
    const result = await runGoWorker("insert-device-event-directly", {
      event_id: String(event_id),
      item_id,
    });

    response.status(201).json({
      inserted_items: result.inserted_items || 0,
      msg: "Item inserted successfully into event",
      ok: true,
    });
  } catch (error) {
    logger.error("Error inserting device directly:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

const deletingItemsInEventAfterDeviceInventoryIsUpdated = async (
  request,
  response,
) => {
  try {
    const { event_id, item_group, category_name, serial_number } = request.body;

    const query = `
      DELETE FROM item_inv_assigned_event
      WHERE event_id = ?
        AND item_id IN (
          SELECT item_id FROM item_inv
          WHERE item_group = ? AND category_name = ? AND serial_number = ?
        )`;
    const values = [event_id, item_group, category_name, serial_number];

    const [result] = await connection.execute(query, values);

    response.status(200).json({
      deleted_items: result.affectedRows,
      msg: "Items deleted successfully from event",
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

const consultingInventoryCurrentState = async (request, response) => {
  try {
    // Las columnas salían de las claves del body tal cual (inyección SQL), y solo
    // la primera llevaba el prefijo `ii.`. Ahora: solo columnas de item_inv, todas
    // con prefijo.
    const fields = Object.keys(request.body ?? {});
    if (fields.length === 0) {
      return response.status(400).json({ ok: false, msg: "At least one filter is required." });
    }
    const invalid = fields.filter((k) => !ITEM_INV_COLUMNS.has(k));
    if (invalid.length > 0) {
      return response.status(400).json({ ok: false, msg: `Invalid field(s): ${invalid.join(", ")}` });
    }
    const formatting = fields.map((k) => `ii.\`${k}\`=?`).join(" AND ");
    const values = fields.map((k) => request.body[k]);
    const query = `
      SELECT ii.item_id, ii.serial_number, ii.warehouse, ii.category_name, ii.item_group, ii.cost, ii.ownership,
             iiae.status, iiae.condition, ei.event_name
      FROM item_inv ii
      LEFT JOIN (
        SELECT item_id, MAX(created_at) AS max_created_at
        FROM item_inv_assigned_event
        GROUP BY item_id
      ) max_iiae ON ii.item_id = max_iiae.item_id
      LEFT JOIN item_inv_assigned_event iiae ON ii.item_id = iiae.item_id AND max_iiae.max_created_at = iiae.created_at
      LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
      WHERE ${formatting};`;

    const [result] = await connection.execute(query, values);
    response.status(200).json({ ok: true, result });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

const checkingInventoryCurrentState = async (request, response) => {
  try {
    const company_id = request.params.company_id;
    const params = request._parsedOriginalUrl.query;
    const splitting = params ? params.split("&") : [];

    // Start with company_id filter; skip client-submitted role/preference
    const filters = [`ii.company_id=?`];
    const values = [company_id];

    splitting.forEach((item) => {
      const [key, value] = item.split("=");
      if (key && key !== "role" && key !== "preference" && key !== "company_id") {
        filters.push(`ii.${key}=?`);
        values.push(value);
      }
    });

    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }
    let formatting = filters.join(" AND ");

    // Full-access: unrestricted. Scoped roles: constrained to their locations/
    // categories (columns prefixed ii.); no assignments → matches nothing (1=0).
    const scope = buildInventoryScopeFilter(userAccess, {
      locationColumn: "ii.location_id",
      categoryColumn: "ii.category_name",
    });
    if (scope.sql) {
      formatting = formatting ? `${formatting} AND ${scope.sql}` : scope.sql;
      values.push(...scope.params);
    }

    const query = `
      SELECT ii.item_id, ii.serial_number, ii.warehouse, ii.category_name, ii.item_group, ii.cost, ii.ownership,
             iiae.status, iiae.condition, ei.event_name
      FROM item_inv ii
      LEFT JOIN (
        SELECT item_id, MAX(created_at) AS max_created_at
        FROM item_inv_assigned_event
        GROUP BY item_id
      ) max_iiae ON ii.item_id = max_iiae.item_id
      LEFT JOIN item_inv_assigned_event iiae ON ii.item_id = iiae.item_id AND max_iiae.max_created_at = iiae.created_at
      LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
      WHERE ${formatting};`;

    const [result] = await connection.execute(query, values);
    response.status(200).json({ ok: true, result });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

const consultingInventoryInEvent = async (request, response) => {
  try {
    const event_id = request.params.id;
    const query = `
      SELECT ii.item_id, ii.category_name, ii.item_group, ii.serial_number, ii.warehouse, ii.brand, 
             ii.main_warehouse, ii.cost, iiae.status, iiae.condition, iiae.updated_at
      FROM item_inv ii
      LEFT JOIN (
        SELECT item_id, MAX(created_at) AS max_created_at
        FROM item_inv_assigned_event
        GROUP BY item_id
      ) max_iiae ON ii.item_id = max_iiae.item_id
      LEFT JOIN item_inv_assigned_event iiae ON ii.item_id = iiae.item_id AND max_iiae.max_created_at = iiae.created_at
      LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
      WHERE ei.event_id = ?
      ORDER BY ii.serial_number ASC`;

    const [result] = await connection.execute(query, [event_id]);
    response.status(200).json({ ok: true, result });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

const consultingRowInItemInvAssignedEventTable = async (request, response) => {
  try {
    const { item_id, company_assigned_event_id } = request.body;
    const query = `
      SELECT ei.* FROM event_info ei
      JOIN item_inv_assigned_event iae ON ei.event_id = iae.event_id 
      WHERE iae.item_id = ? AND ei.company_assigned_event_id = ?`;

    const [result] = await connection.execute(query, [
      item_id,
      company_assigned_event_id,
    ]);
    response.status(200).json({ ok: true, result });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

const deletingRecordInItemInvAssignedEventRow = async (request, response) => {
  try {
    const { event_id, item_id } = request.body;
    const query = `DELETE FROM item_inv_assigned_event WHERE event_id = ? AND item_id = ?`;

    const [result] = await connection.execute(query, [event_id, item_id]);
    response.status(200).json({
      deleted_items: result.affectedRows,
      msg: "Item deleted successfully from event",
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

// Fire-and-forget de verdad: el original no usaba el resultado del Go worker
// para nada, solo respondía un mensaje genérico — por eso es la única
// mutación del Go worker que se encola (ver DESIGN_task_queue.md § Fase 2).
const buildInsertDeviceEventContainerPayload = (body) => ({
  event_id: String(body.event_id),
  refDatabase: body.refDatabase,
});

// Sin dedup, el retry automático del cliente reencolaba el MISMO lote y el
// INSERT del Go worker lo volvía a insertar (el comando ahora usa
// INSERT IGNORE, pero eso solo cubre la fila repetida, no el trabajo repetido).
// Mismo patrón namespaced que inventory:bulk-insert-alphanumeric
// (mysql/controllers/item.js) y document:upload-pdf: se namespacea por tipo de
// job para que dos endpoints distintos no choquen con la misma clave del cliente.
const buildInsertDeviceEventContainerIdempotencyKey = (_body, request) => {
  const clientKey =
    typeof request?.get === "function"
      ? request.get("Idempotency-Key") || request.get("idempotency-key")
      : undefined;
  return clientKey && String(clientKey).trim()
    ? `go-worker:insert-device-event-container:${String(clientKey).trim()}`
    : undefined;
};

const insertingDeviceInEventDirectlyFromContainer = createQueuedJobController(
  "go-worker:insert-device-event-container",
  buildInsertDeviceEventContainerPayload,
  {
    idempotencyKeyFn: buildInsertDeviceEventContainerIdempotencyKey,
    buildSuccessBody: (job) => ({ msg: "Items queued for insertion into event", ok: true, jobId: job.id }),
  }
);

const consultingLeaseInformationConsumer = async (request, response) => {
  try {
    const body = request.body || {};
    const keys = Object.keys(body);

    if (keys.length === 0) {
      return response
        .status(400)
        .json({ msg: "No filters provided in request.body", ok: false });
    }

    // Guard against SQL injection via column names; allow typical identifier characters
    const validKeys = keys.filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
    if (validKeys.length === 0) {
      return response
        .status(400)
        .json({ msg: "No valid filter keys provided", ok: false });
    }

    const formatting = validKeys.map((k) => `\`${k}\`=?`).join(" AND ");
    const values = validKeys.map((k) => body[k]);

    const query = `SELECT * FROM lease_customer_info WHERE ${formatting}`;
    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, result });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ msg: error.message, ok: false });
  }
};

// Was calling updateLargeData(fakeReq, response) and
// insertingItemInEvent(request, response) directly, reusing the SAME
// `response` object those Express handlers use to send their own HTTP
// response — plus this function's own final response.json() call. Three
// attempts to terminate the same response: only the first one
// (updateLargeData) actually reached the client; Express fails the rest
// ("Cannot set headers after they are sent"), so the composed result
// ({inserted, result, updateResult}) never arrived, and this made it look
// like the `updates` sent to update-large-data were never applied — in
// reality the request after it (insertingItemInEvent) and the final response
// were silently failing to send.
//
// Fix: call the pure performUpdateLargeData/performInsertingItemInEvent
// (no req/res) and send exactly ONE response built from both results.
function createAllocateDeviceToEvent({
  connectionFn = getConnection,
  performUpdateLargeDataFn = performUpdateLargeData,
  performInsertingItemInEventFn = performInsertingItemInEvent,
} = {}) {
  return async function allocateDeviceToEvent(request, response) {
    try {
      const { event_id, item_group, company_id, category_name, data, warehouse, logistic_status } =
        request.body;

      if (!data || data.length === 0) {
        return response.status(400).json({
          message: "No items were provided to be allocated to the event.",
          ok: false,
        });
      }

      const connection = connectionFn();
      const placeholders = data.map(() => "?").join(",");
      // serial_number entra al SELECT para poder decir CUÁLES seriales no
      // resolvieron: con solo item_id, un match parcial (7 de 10) era
      // indistinguible de un match completo y el evento salía incompleto
      // reportado como completo. Es aditivo: quien lea result[].item_id sigue igual.
      const query = `SELECT item_id, serial_number from item_inv
                     where company_id = ? AND item_group = ?
                     AND category_name = ?
                     AND serial_number IN (${placeholders})`;
      const values = [company_id, item_group, category_name, ...data];
      const [result] = await connection.execute(query, values);

      const matchedSerials = new Set(result.map((item) => String(item.serial_number)));
      const unresolvedSerials = data.filter((serial) => !matchedSerials.has(String(serial)));

      // 422, no 500: que los cuatro filtros (company_id + item_group +
      // category_name + serial) no casen es un payload equivocado, no una falla
      // del servidor. Como 5xx el cliente lo reintentaba en vano y el UI no
      // podía distinguir "corregí el serial" de "reintentá más tarde".
      // El `msg` se conserva textual para no romper a quien lo compare.
      if (result.length === 0) {
        return response.status(422).json({
          matched_count: 0,
          msg: "No items to allocate",
          ok: false,
          requested_count: data.length,
          unresolved_serials: unresolvedSerials,
        });
      }

      const itemIds = result.map((item) => item.item_id);

      const updateResult = await performUpdateLargeDataFn(
        { item_ids: itemIds, company_id, updates: { logistic_status, warehouse } },
        {}
      );
      const insertedItemInEvent = await performInsertingItemInEventFn(
        { event_id, item_group, category_name, company_id, data },
        {}
      );

      return response.status(200).json({
        inserted: insertedItemInEvent,
        matched_count: result.length,
        ok: true,
        requested_count: data.length,
        result,
        unresolved_serials: unresolvedSerials,
        updateResult,
      });
    } catch (error) {
      logger.error("Error allocating device to event:", error.message);
      return response.status(error.statusCode || 500).json({
        error: error.message,
        ok: false,
      });
    }
  };
}
const allocateDeviceToEvent = createAllocateDeviceToEvent();

// Un placeholder por item EXPANDIDO (contenedores + su contenido) en UNA sola
// sentencia: 500 contenedores de 20 hijos son 10.500 placeholders, arriba del
// max_allowed_packet y del límite de Vitess. Se trocea igual que
// lockItemsForEvent (mismo CHUNK_SIZE), y como los lotes viven dentro de la
// misma transacción, sigue siendo todo-o-nada.
const CONTAINER_CHUNK_SIZE = 1000;

const chunkList = (items, size = CONTAINER_CHUNK_SIZE) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

// Factory con inyección por la misma razón que createAllocateDeviceToEvent
// arriba: el handler toma la conexión y el pool de Mongo del módulo, así que
// sin esto no hay forma de verificar el troceo sin una DB real.
function createAllocateDeviceMarkedAsContainerInEvent({
  connectionFn = getConnection,
  poolReceiversBulkFn = poolReceiversBulkWorker,
  chunkSize = CONTAINER_CHUNK_SIZE,
} = {}) {
  return async function allocateDeviceMarkedAsContainerInEvent(request, response) {
    let connection;

    try {
      const { company_id, event_id, data, warehouse, eventName, company_id_nosql, logistic_status } = request.body;

      if (!company_id || !event_id) {
        return response
          .status(400)
          .json({ message: "company_id and event_id are required.", ok: false });
      }

      if (!Array.isArray(data) || data.length === 0) {
        return response.status(400).json({
          message: "No items were provided to be allocated to the event.",
          ok: false,
        });
      }

      connection = await connectionFn().getConnection();
      await connection.beginTransaction();

      const containers = [];
      for (const serialChunk of chunkList(data, chunkSize)) {
        const placeholders = serialChunk.map(() => "?").join(",");
        const containerQuery = `
          SELECT ii.item_id, ci.child_ids
          FROM container_items ci
          JOIN item_inv ii ON ii.item_id = ci.container_item_id
          WHERE ii.serial_number IN (${placeholders})
            AND ii.company_id = ?;
        `;

        const [rows] = await connection.execute(containerQuery, [
          ...serialChunk,
          company_id,
        ]);
        containers.push(...rows);
      }

      if (containers.length === 0) {
        await connection.rollback();
        return response.status(404).json({
          message: "No containers found with the provided serial numbers.",
          ok: false,
        });
      }

      const containerItemIds = containers.map((c) => c.item_id);

      const childItemIds = containers
        .flatMap((c) => {
          if (!c.child_ids) return [];
          if (Array.isArray(c.child_ids)) return c.child_ids;
          if (typeof c.child_ids === "string") {
            try {
              const parsed = JSON.parse(c.child_ids);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          }
          return [];
        })
        .filter((id) => id != null);

      const allItemsToProcess = [
        ...new Set([...containerItemIds, ...childItemIds]),
      ];

      if (allItemsToProcess.length === 0) {
        await connection.rollback();
        return response
          .status(200)
          .json({ message: "The specified containers are empty.", ok: true });
      }

      // 1) Update warehouse + 2) Assign to event (do both in SQL transaction)
      for (const itemChunk of chunkList(allItemsToProcess, chunkSize)) {
        const allItemsPlaceholder = itemChunk.map(() => "?").join(",");

        const updateQuery = `
          UPDATE item_inv
          SET warehouse = ?, logistic_status = ?
          WHERE company_id = ?
            AND item_id IN (${allItemsPlaceholder});
        `;
        await connection.execute(updateQuery, [warehouse, logistic_status, company_id, ...itemChunk]);

        const insertPlaceholders = itemChunk.map(() => "(?, ?)").join(", ");
        const insertQuery = `
          INSERT IGNORE INTO item_inv_assigned_event (event_id, item_id)
          VALUES ${insertPlaceholders};
        `;
        const insertValues = itemChunk.flatMap((id) => [event_id, id]);
        await connection.execute(insertQuery, insertValues);
      }

      // Build props only for children (the receivers inside the container)
      const resultProps = [];
      for (const childChunk of chunkList(childItemIds, chunkSize)) {
        const placeholderChildren = childChunk.map(() => "?").join(",");
        const queryToPassAsPropsQuery = `
          SELECT item_group, category_name, serial_number
          FROM item_inv
          WHERE company_id = ?
            AND item_id IN (${placeholderChildren});
        `;
        const [rows] = await connection.execute(queryToPassAsPropsQuery, [
          company_id,
          ...childChunk,
        ]);
        resultProps.push(...rows);
      }

      const [companyInfo] = await connection.execute(
        `SELECT company_name FROM company_info WHERE company_id = ?`,
        [company_id],
      );
      const providerName = companyInfo?.[0]?.company_name ?? "N/A";

      // Commit SQL first (avoids partial rollback between SQL and Mongo)
      await connection.commit();

      // Now push to Mongo pool (only if there are child devices)
      if (resultProps.length > 0) {
        const poolPayload = {
          type: resultProps[0]?.item_group,
          activity: false,
          comment: "No comment.",
          company: company_id_nosql,
          deviceList: resultProps.map((item) => ({
            category_name: item.category_name,
            device: item.serial_number,
            item_group: item.item_group,
          })),
          eventSelected: eventName,
          provider: providerName,
          status: "Operational",
        };
        await poolReceiversBulkFn(poolPayload);
      }

      return response.status(200).json({
        message: `${allItemsToProcess.length} total items (including containers and their contents) were allocated to the event.`,
        ok: true,
        props: resultProps,
        result: { allItemsToProcess },
      });
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch { }
      }
      logger.error(error);

      return response.status(500).json({
        error: error?.message || "Unknown error",
        ok: false,
      });
    } finally {
      if (connection) connection.release();
    }
  };
}
const allocateDeviceMarkedAsContainerInEvent = createAllocateDeviceMarkedAsContainerInEvent();

const lockItemsForEvent = async (request, response) => {
  let connection;
  try {
    const { event_id, company_id, items } = request.body;
    const CHUNK_SIZE = 1000; // Process 1000 items per batch

    if (!event_id || !company_id || !Array.isArray(items) || items.length === 0) {
      return response.status(400).json({
        message: "event_id, company_id, and a non-empty array of item IDs are required.",
        ok: false,
      });
    }

    connection = await getConnection().getConnection();
    await connection.beginTransaction();

    let totalAffectedRows = 0;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const insertQuery = `
        INSERT INTO event_item_shipping (event_id, item_id, company_id)
        VALUES ?;
      `;
      const values = chunk.map(item_id => [event_id, item_id, company_id]);
      const [result] = await connection.query(insertQuery, [values]);
      totalAffectedRows += result.affectedRows;
    }

    await connection.commit();

    return response.status(201).json({
      message: `${totalAffectedRows} item(s) have been locked for event ${event_id}.`,
      ok: true,
      total_locked: totalAffectedRows,
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    logger.error("Error locking items for event:", error.message);
    return response.status(500).json({
      error: error.message || "An internal error occurred while locking items.",
      ok: false,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const reserveItemsInInventoryForEvent = async (request, response) => {
  let connection
  try {
    connection = await getConnection().getConnection();
    await connection.beginTransaction();
    const { company_id, items } = request.body;
    console.log("Reserving items for company_id:", company_id, "Items:", items);
    const queryToReserveItems = `
      UPDATE item_inv
      SET logistic_status = "in-reserved"
      WHERE company_id = ?
        AND item_id IN (${items.map(() => "?").join(",")});
    `;
    const [result] = await connection.execute(queryToReserveItems, [
      company_id,
      ...items,
    ]);
    if (result.affectedRows === 0) {
      return response.status(404).json({
        message: "No items found in the inventory to reserve.",
        ok: false,
      });
    }
    console.log(result, "items reserved successfully for company_id:", company_id);
    return response.status(200).json({
      message: `${result.affectedRows} item(s) have been reserved in the inventory.`,
      ok: true,
      total_reserved: result.affectedRows,
    });
  } catch (error) {
    logger.error("Error reserving items in inventory for event:", error.message);
    return response.status(500).json({
      error: error.message || "An internal error occurred while reserving items.",
      ok: false,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const removeReservedItemsInInventoryForEvent = async (request, response) => {
  try {
    const { event_id, company_id, item_id } = request.body;
    const queryToRemoveReservedItems = `
    DELETE FROM event_item_shipping
    WHERE event_id = ?
      AND company_id = ?
      AND item_id IN (${item_id.map(() => "?").join(",")});
  `;
    const [result] = await connection.execute(queryToRemoveReservedItems, [
      event_id,
      company_id,
      ...item_id,
    ]);
    if (result.affectedRows === 0) {
      return response.status(404).json({
        message: "No items found in the event item shipping table to remove.",
        ok: false,
      });
    }
    return response.status(200).json({
      message: `${result.affectedRows} item(s) have been removed from the event item shipping table.`,
      ok: true,
      total_removed: result.affectedRows,
    });
  } catch (error) {

  }
}

module.exports = {
  allocateDeviceMarkedAsContainerInEvent,
  allocateDeviceToEvent,
  chunkList,
  createAllocateDeviceMarkedAsContainerInEvent,
  createAllocateDeviceToEvent,
  createInsertingItemInEvent,
  performInsertingItemInEvent,
  buildInsertDeviceEventContainerIdempotencyKey,
  buildInsertDeviceEventContainerPayload,
  bulkUpdateEventItemShipping,
  checkingInventoryCurrentState,
  consultingInventoryCurrentState,
  consultingInventoryInEvent,
  consultingLeaseInformationConsumer,
  consultingRowInItemInvAssignedEventTable,
  deletingItemsInEventAfterDeviceInventoryIsUpdated,
  deletingRecordInItemInvAssignedEventRow,
  getEventItemShipping,
  insertingDeviceInEventDirectly,
  insertingDeviceInEventDirectlyFromContainer,
  insertingItemInEvent,
  lockItemsForEvent,
  removeEventItemShipping,
  reserveItemsInInventoryForEvent,
  updateEventItemShipping,
  removeReservedItemsInInventoryForEvent
};