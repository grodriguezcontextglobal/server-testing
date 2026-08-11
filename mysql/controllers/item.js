const { response } = require("express");
const getConnection = require("../database/config");
const { clientRedis } = require("../../database/cacheMemoryConfig");
const logger = require("../../helpers/logger");
const runGoWorker = require("../../helpers/goWorker");
const { describeSqlShape } = require("../../helpers/sqlShape");
const {
  buildNamedQuery,
  QueryParamError,
} = require("../queries/inventoryQueryCatalog");
const { resolveCompanyContext } = require("../helpers/companyContext");
const {
  processSubLocation,
  processSubLocationPath,
  resolveSubLocationFilter,
} = require("./sub_location");
const ReceiversPool = require("../../models/ReceiversPool");
const { groupBy } = require("lodash");
const { enqueue, extractJobContext } = require("../../helpers/queue");
const { createQueuedJobController, waitForJobOutcome } = require("../../helpers/queuedController");
const { resolveUpdatePlan } = require("../../queue/handlers/inventoryBulkUpdateAlphanumeric");
const { chunkArray } = require("../../helpers/chunkArray");
require("dotenv").config();

// Rows per INSERT statement for bulk writes -- see insertBulkItem.
const BULK_INSERT_BATCH_SIZE = 500;

const {
  getStaffCompanyAccess,
  buildInventoryScopeFilter,
  applyWorkerScope,
  canWriteInScope,
  getWritableScope,
} = require("../helpers/staffAccess");

const ITEM_INV_COLUMNS = new Set([
  "item_id",
  "category_name",
  "sub_category_name",
  "item_group",
  "sub_item_group",
  "cost",
  "brand",
  "descript_item",
  "ownership",
  "main_warehouse",
  "serial_number",
  "warehouse",
  "company",
  "location",
  "sub_location",
  "location_id",
  "current_location",
  "extra_serial_number",
  "company_id",
  "return_date",
  "container",
  "containerSpotLimit",
  "enableAssignFeature",
  "image_url",
  "returnedRentedInfo",
  "container_id",
  "display_item",
  "supplier_info",
  "create_at",
  "update_at",
]);

// throw new Error("SERVER HAS RESTARTED AND LOADED THE NEW FILE. This is an intentional test.");

/**
 * Removes records from the ReceiversPool based on a flexible set of criteria.
 * This function is designed to handle bulk deletions efficiently by filtering serial
 * numbers from a SQL database and then performing a bulk delete on a MongoDB collection.
 *
 * @param {object} options
 * @param {object} options.connection - An active MySQL connection.
 * @param {string[]} options.serial_numbers - A list of serial numbers to process.
 * @param {string} options.sql_company_id - The company ID for the SQL database (item_inv).
 * @param {string} options.nosql_company_id - The company ID for the MongoDB (ReceiversPool).
 * @param {string} options.eventSelected - The event identifier for MongoDB.
 * @param {string[]} [options.category_names] - Optional list of category names to filter by in `item_inv`.
 * @param {string[]} [options.item_types] - Optional list of item types to use for filtering the `type` field in `ReceiversPool`.
 * @returns {Promise<number>} The number of records deleted from the pool.
 */
const removePoolRecordsByCriteria = async (options) => {
  const {
    connection,
    serial_numbers,
    sql_company_id,
    nosql_company_id,
    eventSelected,
  } = options;

  // 1. Input validation
  if (
    !connection ||
    !Array.isArray(serial_numbers) ||
    serial_numbers.length === 0 ||
    !sql_company_id ||
    !nosql_company_id ||
    !eventSelected
  ) {
    logger.error(
      "[removePoolRecordsByCriteria] Error: Missing required parameters.",
    );
    // Returning 0 as it's part of a larger transaction and shouldn't crash it.
    return 0;
  }

  let serialsToFilter = [...serial_numbers];
  let results = [];
  // 2. Further filter serial numbers from item_inv if category_names criteria is given
  const query =
    "SELECT serial_number, item_group FROM item_inv WHERE company_id = ? AND serial_number IN (?)";
  const values = [sql_company_id, serialsToFilter];
  [results] = await connection.query(query, values);
  serialsToFilter = results.map((r) => r.serial_number);

  if (serialsToFilter.length === 0) {
    logger.info(
      "[removePoolRecordsByCriteria] No devices matched SQL-side filters.",
    );
    return 0; // No devices match the SQL-side filters.
  }

  const groupingDataInRightFormat = groupBy(results, "item_group");
  let totalDeleted = 0;

  for (const key in groupingDataInRightFormat) {
    const mongoQuery = {
      type: key,
      company: nosql_company_id,
      contract_type: "event",
      device: {
        $in: groupingDataInRightFormat[key].map((item) => item.serial_number),
      },
      eventSelected: eventSelected,
    };
    const result = await ReceiversPool.deleteMany(mongoQuery);
    totalDeleted += result.deletedCount;
  }

  logger.info(
    `[removePoolRecordsByCriteria] Deleted ${totalDeleted} devices from pool.`,
  );
  return totalDeleted;
};

const getLocationId = async (connection, company_id, location_name) => {
  if (!company_id || !location_name) return null;
  const [rows] = await connection.execute(
    "SELECT location_id FROM locations WHERE company_id = ? AND location_name = ?",
    [company_id, location_name],
  );
  return rows.length > 0 ? rows[0].location_id : null;
};

const insertingItem = async (request, response) => {
  const pool = getConnection();
  const connection = await pool.getConnection(); // Get dedicated connection for transaction

  const {
    category_name,
    sub_category_name,
    item_group,
    sub_item_group,
    cost,
    brand,
    descript_item,
    ownership,
    main_warehouse,
    serial_number,
    warehouse,
    company,
    location, // Legacy name or object
    sub_location, // Legacy name/JSON or object
    current_location,
    extra_serial_number,
    company_id,
    return_date,
    container,
    containerSpotLimit,
    image_url,
    supplier_info,
    // Extra fields for location/sub-location creation
    location_name,
    sub_location_name,
    sub_location_parent_id,
    returnedRentedInfo,
    container_id,
    display_item,
  } = request.body;

  try {
    await connection.beginTransaction();

    // 1. Process Location
    // Determine location name from various possible inputs
    const locName =
      location_name ||
      (typeof location === "string" ? location : location?.name || null);

    let locationId = null;
    let finalLocationName = locName;

    if (company_id && locName) {
      // Lookup Location ID (Strict Validation)
      locationId = await getLocationId(connection, company_id, locName);

      if (!locationId) {
        throw new Error(
          `Location '${locName}' not found for company '${company_id}'.`,
        );
      }
      finalLocationName = locName;
    } else {
      if (!company_id || !locName) {
        throw new Error("Company ID and Location Name are required.");
      }
    }

    // 2. Process Sub-Location (Optional) — Fase 4a
    //    Resolvemos/creamos la cadena jerárquica completa y persistimos el
    //    sub_location_id de la HOJA. Se sigue escribiendo el JSON legacy en la
    //    columna `sub_location` (doble write temporal, no rompe la vista árbol).
    let subLocationId = null;
    let finalSubLocationName = sub_location; // Default to input (legacy column)

    if (locationId && sub_location_name) {
      // Caso explícito: nombre único (+ parent opcional) — comportamiento original
      const subLocResult = await processSubLocation(connection, {
        active: true,
        location_id: locationId,
        name: sub_location_name,
        parent_id: sub_location_parent_id || null,
        company_id,
      });
      subLocationId = subLocResult.sub_location_id;
      finalSubLocationName = subLocResult.name;
    } else if (locationId && sub_location != null) {
      // Caso path: array (o JSON string de array) de nombres, o nombre simple
      let segments = [];
      if (Array.isArray(sub_location)) {
        segments = sub_location;
      } else if (typeof sub_location === "string") {
        try {
          const parsed = JSON.parse(sub_location);
          segments = Array.isArray(parsed) ? parsed : [sub_location];
        } catch (e) {
          segments = [sub_location];
        }
      } else if (typeof sub_location === "object" && sub_location.name) {
        segments = [sub_location.name];
      }

      if (segments.length) {
        subLocationId = await processSubLocationPath(
          connection,
          locationId,
          segments,
          company_id,
        );
      }
    }

    // 3. Prepare Data for Insertion
    // Validate and sanitize inputs
    const parsedCost = isNaN(parseFloat(cost)) ? 0 : parseFloat(cost);
    const parsedWarehouse =
      warehouse === true ||
        warehouse === "true" ||
        warehouse === 1 ||
        warehouse === "1"
        ? 1
        : 0;
    const parsedContainer =
      container === true ||
        container === "true" ||
        container === 1 ||
        container === "1"
        ? 1
        : 0;
    const parsedDisplayItem =
      display_item === undefined ? 1 : display_item ? 1 : 0; // Default to 1
    const parsedContainerSpotLimit = isNaN(parseInt(containerSpotLimit))
      ? 0
      : parseInt(containerSpotLimit);

    // JSON fields: ensure they are strings for DB storage if they are objects/arrays
    const formatJsonField = (val) => {
      if (val === undefined || val === null) return JSON.stringify([]);
      return typeof val === "string" ? val : JSON.stringify(val);
    };

    const finalReturnedRentedInfo = formatJsonField(returnedRentedInfo);
    const finalContainerId = formatJsonField(container_id);
    const finalExtraSerialNumber =
      typeof extra_serial_number === "object"
        ? JSON.stringify(extra_serial_number)
        : extra_serial_number;

    // 4. Insert Item
    const query = `
      INSERT INTO item_inv (
        category_name,
        sub_category_name,
        item_group,
        sub_item_group,
        cost,
        brand,
        descript_item,
        ownership,
        main_warehouse,
        serial_number,
        warehouse,
        company,
        location,
        sub_location,
        location_id,
        sub_location_id,
        current_location,
        extra_serial_number,
        company_id,
        return_date,
        container,
        containerSpotLimit,
        enableAssignFeature,
        image_url,
        returnedRentedInfo,
        container_id,
        display_item,
        supplier_info
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      category_name,
      sub_category_name || null,
      item_group,
      sub_item_group || null,
      parsedCost,
      brand,
      descript_item,
      ownership,
      main_warehouse,
      serial_number,
      parsedWarehouse,
      company,
      finalLocationName, // Legacy location column
      finalSubLocationName, // Legacy sub_location column
      locationId, // New location_id column
      subLocationId, // New sub_location_id column (leaf of the path) — Fase 4a
      current_location,
      finalExtraSerialNumber,
      company_id,
      return_date || null,
      parsedContainer,
      parsedContainerSpotLimit,
      1, // enableAssignFeature default to 1 as per original code
      image_url || null,
      finalReturnedRentedInfo,
      finalContainerId,
      parsedDisplayItem,
      supplier_info || null,
    ];

    // Scope write gate (create): a location/category-scoped role may only create
    // items within its assigned scope (with can_create). Full-access roles pass.
    // rollback + return is safe here — the `finally` still releases the connection.
    const creatorAccess = await getStaffCompanyAccess(request.sqlStaffId, company_id);
    if (!creatorAccess) {
      await connection.rollback();
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }
    if (!(await canWriteInScope(creatorAccess, "create", { locationId, categoryName: category_name }))) {
      await connection.rollback();
      return response.status(403).json({ ok: false, msg: "Not allowed to create items in this location/category" });
    }

    console.log(values);
    const [result] = await connection.execute(query, values);

    await connection.commit();

    return response.status(201).json({
      item: {
        ...result,
        location_id: locationId,
        sub_location_id: subLocationId,
      },
      msg: "Item created successfully",
      ok: true,
    });
  } catch (error) {
    await connection.rollback();
    logger.error("insertingItem error:", error);
    const status = error.message.includes("not found") ? 404 : 500;
    return response.status(status).json({
      msg: error.message,
      ok: false,
    });
  } finally {
    connection.release();
  }
};

// Migrado a cola (ver project_bulk_queue_migration_plan.md): un rango
// min/max de serial lo EXPANDE EL SERVIDOR, sin techo natural (2 números
// pueden generar millones de filas) -- el mayor riesgo de volumen de los 7
// bulk fixes de la sesión anterior. El controller solo resuelve
// location_id/valida scope (rápido, igual que insertBulkItemAlhpanumericFormat)
// y encola; el INSERT real vive en queue/handlers/bulkInsertItemRange.js.
// A diferencia de ese hermano (fire-and-forget 202), este usa
// waitForJobOutcome para NO romper el contrato en el caso típico: si el job
// termina dentro de maxWaitMs (con el worker DEDICADO de poll rápido, no el
// genérico de 4s) responde 201 con la misma forma de siempre; solo una
// carga verdaderamente enorme cae al 202+jobId.
function createInsertBulkItemRange({
  getLocationIdFn = getLocationId,
  enqueueFn = enqueue,
  extractContextFn = extractJobContext,
  connectionFn = getConnection,
  getStaffCompanyAccessFn = getStaffCompanyAccess,
  canWriteInScopeFn = canWriteInScope,
  waitForJobOutcomeFn = waitForJobOutcome,
  maxWaitMs = 4000,
} = {}) {
  return async function insertBulkItem(request, response) {
    try {
      const { location, company_id, category_name, min_serial_number, max_serial_number } = request.body;

      const locName = typeof location === "string" ? location : location?.name;
      if (!locName || !company_id) {
        return response.status(400).json({
          msg: "Company ID and Location Name are required.",
          ok: false,
        });
      }

      const connection = connectionFn();
      const locationId = await getLocationIdFn(connection, company_id, locName);
      if (!locationId) {
        return response.status(404).json({
          msg: `Location '${locName}' not found.`,
          ok: false,
        });
      }

      // Scope write gate (create): a location/category-scoped role may only bulk-create
      // items within its assigned scope (with can_create). Every row shares this single
      // location + category, so an all-or-nothing check is correct here. Full-access passes.
      const creatorAccess = await getStaffCompanyAccessFn(request.sqlStaffId, company_id);
      if (!creatorAccess) {
        return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
      }
      if (!(await canWriteInScopeFn(creatorAccess, "create", { locationId, categoryName: category_name }))) {
        return response.status(403).json({ ok: false, msg: "Not allowed to create items in this location/category" });
      }

      if (!min_serial_number || !max_serial_number) {
        return response.status(400).json({
          msg: "Minimum and maximum serial numbers are required.",
          ok: false,
        });
      }

      const payload = { ...request.body, location: locName, location_id: locationId };
      const job = await enqueueFn("inventory:bulk-insert-range", payload, {
        context: extractContextFn(request),
      });

      const outcome = await waitForJobOutcomeFn(job, { maxWaitMs });
      if (outcome.outcome === "done") {
        return response.status(201).json({ item: outcome.result, ok: true });
      }
      if (outcome.outcome === "failed") {
        return response.status(500).json({
          ok: false,
          msg: outcome.job.lastError || "Bulk insert failed",
        });
      }
      return response.status(202).json({
        ok: true,
        jobId: job.id,
        msg: "Request queued — still processing. Poll GET /api/jobs/owned/:jobId for the result.",
      });
    } catch (error) {
      response.status(500).json({
        err: error,
        msg: `${error.message}`,
        ok: false,
      });
    }
  };
}
const insertBulkItem = createInsertBulkItemRange();

// Migrado al contrato async (202 + jobId, ver DESIGN_task_queue.md § Fase 4b):
// hasta 15,000 seriales por request, insertados síncronamente antes sostenían
// la conexión HTTP abierta varios segundos/minutos sin transacción real (cada
// batch de 1000 se autocommiteaba independiente) ni idempotencia — un timeout
// de cliente + retry duplicaba filas completas. Ahora solo se valida/resuelve
// location_id (rápido) y se encola el resto; el INSERT real vive en
// queue/handlers/inventoryBulkInsert.js dentro de una única transacción.
function createInsertBulkItemAlphanumeric({
  getLocationIdFn = getLocationId,
  enqueueFn = enqueue,
  extractContextFn = extractJobContext,
  connectionFn = getConnection,
  getStaffCompanyAccessFn = getStaffCompanyAccess,
  canWriteInScopeFn = canWriteInScope,
} = {}) {
  return async function insertBulkItemAlhpanumericFormat(request, response) {
    try {
      const { location, company_id, category_name } = request.body;

      const locName = typeof location === "string" ? location : location?.name;
      if (!locName || !company_id) {
        return response.status(400).json({
          msg: "Company ID and Location Name are required.",
          ok: false,
        });
      }

      const connection = connectionFn();
      const locationId = await getLocationIdFn(connection, company_id, locName);
      if (!locationId) {
        return response.status(404).json({
          msg: `Location '${locName}' not found.`,
          ok: false,
        });
      }

      // Scope write gate (create): scoped roles may only enqueue bulk inserts within
      // their assigned scope (with can_create). Single location + category per request,
      // so an all-or-nothing check is correct. Full-access roles pass.
      const access = await getStaffCompanyAccessFn(request.sqlStaffId, company_id);
      if (!access) {
        return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
      }
      if (!(await canWriteInScopeFn(access, "create", { locationId, categoryName: category_name }))) {
        return response.status(403).json({ ok: false, msg: "Not allowed to create items in this location/category" });
      }

      const payload = { ...request.body, location_id: locationId };
      const context = extractContextFn(request);

      // Idempotencia: mismo patrón que document:upload-pdf (controller/document.js).
      // Namespaced por tipo para no chocar con claves iguales de otros job types.
      const clientKey =
        typeof request.get === "function"
          ? request.get("Idempotency-Key") || request.get("idempotency-key")
          : undefined;
      const idempotencyKey = clientKey
        ? `inventory:bulk-insert-alphanumeric:${String(clientKey).trim()}`
        : undefined;

      const job = await enqueueFn("inventory:bulk-insert-alphanumeric", payload, {
        context,
        idempotencyKey,
      });

      return response.status(202).json({
        msg: "Bulk items queued for insertion",
        ok: true,
        jobId: job.id,
      });
    } catch (error) {
      logger.error("Error in insertBulkItemAlhpanumericFormat:", error);
      response.status(500).json({
        msg: error.message,
        ok: false,
      });
    }
  };
}
const insertBulkItemAlhpanumericFormat = createInsertBulkItemAlphanumeric();

const consultingItem = async (request, response) => {
  try {
    const connection = getConnection();
    const invalidCols = Object.keys(request.body).filter((k) => !ITEM_INV_COLUMNS.has(k));
    if (invalidCols.length > 0) {
      return response.status(400).json({ ok: false, msg: `Invalid field(s): ${invalidCols.join(", ")}` });
    }
    const formatting = Object.keys(request.body)
      .map((item) => `\`${item}\`=?`)
      .join(" AND ");
    const values = Object.values(request.body);
    const query = `SELECT * FROM item_inv WHERE ${formatting};`;
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      items: result,
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const deleteItem = async (request, response) => {
  try {
    const connection = getConnection();
    const { item_id, company_id } = request.body;
    if (!item_id || !company_id) {
      return response.status(400).json({ ok: false, msg: "item_id and company_id are required" });
    }

    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }

    // Load the item's own scope (and enforce multi-tenant: it must belong to company_id).
    const [[item]] = await connection.execute(
      "SELECT location_id, category_name FROM item_inv WHERE item_id = ? AND company_id = ? LIMIT 1",
      [item_id, company_id]
    );
    if (!item) {
      return response.status(404).json({ ok: false, msg: "Item not found for this company" });
    }

    // Per-assignment write gate: scoped roles need can_delete on the item's location/category.
    const allowed = await canWriteInScope(userAccess, "delete", {
      locationId: item.location_id,
      categoryName: item.category_name,
    });
    if (!allowed) {
      return response.status(403).json({ ok: false, msg: "Not allowed to delete items in this location/category" });
    }

    const [result] = await connection.execute(
      "DELETE FROM item_inv WHERE item_id = ? AND company_id = ?",
      [item_id, company_id]
    );
    return response.status(201).json({
      item_deleted: result,
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const consultingItemTable = async (request, response) => {
  try {
    const connection = getConnection();
    const query = "SELECT * FROM item_inv WHERE company=?;";
    const values = [request.body.company];
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      items: result,
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const consultingItemInWarehouseTable = async (request, response) => {
  try {
    const connection = getConnection();
    const { role: _role, preference: _pref, ...filters } = request.body;
    const { company_id } = filters;

    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }
    // Base query construction
    let formatting = Object.keys(filters).map((item) => `${item}=?`).join(" AND ");
    const values = Object.values(filters);

    // Full-access roles: no restriction. Location/category-scoped roles: restricted
    // to their assignments; a scoped role with no assignments matches nothing (1=0).
    const scope = buildInventoryScopeFilter(userAccess);
    if (scope.sql) {
      formatting = formatting ? `${formatting} AND ${scope.sql}` : scope.sql;
      values.push(...scope.params);
    }

    const query = `SELECT * FROM item_inv WHERE ${formatting};`;
    const [result] = await connection.execute(query, values);

    return response.status(201).json({ items: result, ok: true });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ msg: error.message, ok: false });
  }
};

const updateItemInTable = async (request, response) => {
  try {
    const connection = getConnection();
    const body = request.body || {};

    // Identifier keys to locate the target item (flexible WHERE clause)
    const identifierKeys = new Set(["item_id", "serial_number", "company_id"]);

    // Whitelist of known columns in item_inv to prevent invalid updates
    const allowedColumns = new Set([
      "category_name",
      "sub_category_name",
      "item_group",
      "sub_item_group",
      "cost",
      "brand",
      "descript_item",
      "ownership",
      "serial_number",
      "warehouse",
      "status",
      "main_warehouse",
      "update_at",
      "company",
      "location",
      "sub_location",
      "current_location",
      "return_date",
      "extra_serial_number",
      "container",
      "container_items",
      "isItInContainer",
      "containerSpotLimit",
      "container_id",
      "display_item",
      "image_url",
      "company_id",
      "enableAssignFeature",
      "returnedRentedInfo",
      "supplier_info",
      "logistic_status",
      "location_id"
    ]);

    // Build WHERE clause from any provided identifiers
    const whereParts = [];
    const whereValues = [];
    for (const [key, value] of Object.entries(body)) {
      if (identifierKeys.has(key) && value !== undefined && value !== null) {
        whereParts.push(`${key} = ?`);
        whereValues.push(value);
      }
    }

    if (whereParts.length === 0) {
      return response.status(400).json({
        msg: "Provide at least one identifying field to target the item (e.g., item_id or serial_number with company_id).",
        ok: false,
      });
    }

    // Scope write gate (update): a location/category-scoped role may only edit
    // items within its CURRENT scope (with can_update). Checked against each
    // targeted item's own location/category. Full-access roles skip this.
    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, body.company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }
    if (userAccess.scoped) {
      const [targetRows] = await connection.execute(
        `SELECT location_id, category_name FROM item_inv WHERE ${whereParts.join(" AND ")}`,
        whereValues
      );
      if (!targetRows.length) {
        return response.status(404).json({ ok: false, msg: "Item not found for this company" });
      }
      for (const target of targetRows) {
        const allowed = await canWriteInScope(userAccess, "update", {
          locationId: target.location_id,
          categoryName: target.category_name,
        });
        if (!allowed) {
          return response.status(403).json({ ok: false, msg: "Not allowed to update items in this location/category" });
        }
      }
    }

    // Build SET clause from provided updatable fields (excluding identifiers)
    const setParts = [];
    const setValues = [];
    for (const [key, value] of Object.entries(body)) {
      if (identifierKeys.has(key)) continue; // identifiers are used in WHERE, not SET
      if (!allowedColumns.has(key)) continue; // ignore unknown columns
      if (value === undefined) continue; // skip undefined, allow null
      setParts.push(`${key} = ?`);
      setValues.push(value);
    }

    if (setParts.length === 0) {
      return response.status(400).json({
        msg: "No valid fields provided to update.",
        ok: false,
      });
    }

    const query = `UPDATE item_inv SET ${setParts.join(
      ", ",
    )} WHERE ${whereParts.join(" AND ")};`;
    const values = [...setValues, ...whereValues];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      items: result,
      ok: true,
      updated_fields: setParts.map((u) => u.split(" = ")[0]),
      where_fields: whereParts.map((w) => w.split(" = ")[0]),
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const returningLeasedEquipmentToCompany = async (request, response) => {
  try {
    const connection = getConnection();
    const {
      item_id, // Item ID to identify the item
      return_date, // New return date
      enableAssignFeature, // New enableAssignFeature status
      returnedRentedInfo, // Information to be updated
    } = request.body;

    // SQL Query for updating the item info, ensuring correct values and order
    const query = `
    UPDATE item_inv 
    SET 
    return_date = ?, 
    enableAssignFeature = ?, 
    returnedRentedInfo = ?
    WHERE item_id = ?`; // 'item_id' used in the WHERE clause

    // Correct values order: [return_date, enableAssignFeature, returnedRentedInfo, item_id]
    const values = [
      return_date, // First, return date
      enableAssignFeature, // Then enableAssignFeature status
      returnedRentedInfo, // Then the additional info
      item_id, // Finally, item_id for WHERE clause
    ];
    // Execute the query
    connection.execute(query, values, function (err, result, fields) {
      if (err) {
        return response.status(401).json({
          ok: false,
          msg: `${err.message}`, // Return error message if query fails
        });
      }
      // Check if any rows were updated
      if (result.changedRows === 0) {
        return response.status(200).json({
          items: result,
          message: "No changes were made to the item.",
          ok: true,
        });
      }

      return response.status(201).json({
        items: result,
        message: "Item updated successfully.",
        ok: true,
      });
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      msg: `${error.message}`,
      ok: false,
    });
  }
};

const updateItemInWarehouseAfterBeingAddedToEvent = async (
  request,
  response,
) => {
  let connection = null;
  try {
    const { warehouse, company_id, item_group, category_name, data, logistic_status = "allocated" } =
      request.body;
    // Validate request body
    if (
      !item_group ||
      !category_name ||
      !company_id ||
      !logistic_status ||
      !Array.isArray(data) ||
      data.length === 0
    ) {
      return response.status(400).json({
        msg: "Missing required fields or invalid data format",
        ok: false,
      });
    }
    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }

    const pool = getConnection();
    connection = await pool.getConnection(); // Get dedicated connection for transaction
    // Prepare the serial numbers for the IN clause
    const serialNumbers = data.map((item) => item.toString());
    const placeholders = serialNumbers.map(() => "?").join(",");

    // Find items query with proper parameterization
    const findIndexQuery = `
      SELECT item_id, serial_number, location_id, category_name
      FROM item_inv
      WHERE item_group = ?
        AND category_name = ?
        AND company_id = ?
        AND serial_number IN (${placeholders})
    `;

    const findIndexValues = [
      item_group,
      category_name,
      company_id,
      ...serialNumbers,
    ];
    const [results] = await connection.execute(findIndexQuery, findIndexValues);

    if (!results || results.length === 0) {
      return response.status(404).json({
        msg: "No matching items found",
        ok: false,
      });
    }

    // Process-only-permitted: this moves inventory in/out of the warehouse, so
    // scoped roles may only touch items within their can_update scope. Non-
    // permitted items are skipped (reported via skipped_count). Full-access passes.
    let scopedResults = results;
    let skippedCount = 0;
    if (userAccess.scoped) {
      const writable = await getWritableScope(userAccess, "update");
      const permitted = new Set((writable.values || []).map(String));
      scopedResults = results.filter((r) =>
        permitted.has(String(writable.dimension === "location" ? r.location_id : r.category_name))
      );
      skippedCount = results.length - scopedResults.length;
      if (scopedResults.length === 0) {
        return response.status(403).json({
          ok: false,
          msg: "Not allowed to update items in this location/category",
          skipped_count: skippedCount,
        });
      }
    }

    // Fix: Keep item_ids as numbers instead of converting to strings
    const itemIds = scopedResults.map((item) => item.item_id);

    const idPlaceholders = itemIds.map(() => "?").join(",");

    // Fix: Spread itemIds array in updateValues
    const updateQuery = `
    UPDATE item_inv 
    SET warehouse = ?, update_at = NOW(), logistic_status = ?
    WHERE item_id IN (${idPlaceholders})
    `;

    const updateValues = [warehouse, logistic_status, ...itemIds];
    await connection.execute(updateQuery, updateValues);

    return response.status(201).json({
      msg: "Items updated successfully",
      ok: true,
      ...(skippedCount > 0 ? { skipped_count: skippedCount } : {}),
    });
  } catch (error) {
    logger.error(
      "Error in updateItemInWarehouseAfterBeingAddedToEvent:",
      error,
    );
    response.status(500).json({
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      msg: `Server error: ${error.message}`,
      ok: false,
    });
  } finally {
    // The dedicated connection was leaked on every path before; release it now.
    if (connection) connection.release();
  }
};

const returningItemToStockWhenEventIsFinished = async (request, response) => {
  try {
    const connection = getConnection();
    // const cache_connection = await clientRedis();
    const {
      status,
      update_at,
      serial_number,
      category_name,
      item_group,
      company_id,
    } = request.body;
    const query = ` UPDATE
    item_inv
    SET
        warehouse = 1,
        status =?,
        update_at =?,
        logistic_status = "in-stock"
    WHERE
    serial_number =?
    and category_name = ?
    and item_group = ?
    and company_id = ?;`;
    const values = [
      status,
      update_at,
      serial_number,
      category_name,
      item_group,
      company_id,
    ];
    const [result] = await connection.execute(query, values);

    return response?.status(201)?.json({
      items: result,
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      msg: `${error.message}`,
      ok: false,
    });
  }
};

const returningItemToStockWhenEventIsFinishedRefactored = async (
  request,
  response,
) => {
  try {
    const {
      groupingDevicesFromNoSQL,
      allInventoryOfEvent,
      companyId,
      update_at,
    } = request.body;

    if (!groupingDevicesFromNoSQL || !allInventoryOfEvent) {
      return response.status(400).json({
        msg: "groupingDevicesFromNoSQL and allInventoryOfEvent are required.",
        ok: false,
      });
    }

    const groupingDevices = JSON.parse(groupingDevicesFromNoSQL);
    const allInventory = JSON.parse(allInventoryOfEvent);

    const connection = getConnection();

    if (!allInventory || allInventory.length === 0) {
      return response.status(200).json({
        affectedRows: 0,
        msg: "No items to update.",
        ok: true,
      });
    }

    const batchSize = 100;
    let totalAffectedRows = 0;

    for (let i = 0; i < allInventory.length; i += batchSize) {
      const batch = allInventory.slice(i, i + batchSize);

      let caseParts = [];
      let values = []; // For CASE
      let serialNumbers = []; // For IN clause

      for (const item of batch) {
        let status = item.status;
        if (
          groupingDevices[item.serial_number] &&
          groupingDevices[item.serial_number].length > 0
        ) {
          status =
            groupingDevices[item.serial_number][
              groupingDevices[item.serial_number].length - 1
            ].status;
        }
        caseParts.push("WHEN serial_number = ? THEN ?");
        values.push(item.serial_number, status);
        serialNumbers.push(item.serial_number);
      }

      if (serialNumbers.length === 0) {
        continue;
      }

      const placeholders = serialNumbers.map(() => "?").join(",");

      const finalValues = [...values, update_at, companyId, ...serialNumbers];

      const query = `
        UPDATE item_inv 
        SET 
            warehouse = 0,
            logistic_status = 'in-transit',
            status = CASE 
                ${caseParts.join(" ")}
                ELSE status 
            END,
            update_at = ?
        WHERE 
            company_id = ? 
            AND serial_number IN (${placeholders})
      `;

      const [result] = await connection.execute(query, finalValues);
      totalAffectedRows += result.affectedRows;
    }

    return response.status(201).json({
      affectedRows: totalAffectedRows,
      msg: `Successfully updated ${totalAffectedRows} items`,
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    logger.error("Stack:", error.stack);
    return response.status(500).json({
      msg: `${error.message}`,
      ok: false,
    });
  }
};

const itemFinalStatusWhenEventIsFinished = async (request, response) => {
  try {
    const connection = getConnection();
    const { status, condition, updated_at, serial_number, event_id } =
      request.body;
    const query = `
    UPDATE item_inv_assigned_event iiae
    JOIN item_inv ii ON iiae.item_id = ii.item_id
    SET iiae.status = ?, iiae.condition = ?, iiae.updated_at = ?, active = 0
                WHERE ii.serial_number = ?
                AND iiae.event_id = ?;
                    `;
    const values = [status, condition, updated_at, serial_number, event_id];
    const [result] = await connection.execute(query, values);
    return response?.status(201)?.json({
      items: result,
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      msg: `${error.message}`,
      ok: false,
    });
  }
};

const itemFinalStatusWhenEventIsFinishedRefactored = async (
  request,
  response,
) => {
  try {
    const {
      groupingDevicesFromNoSQL,
      allInventoryOfEvent,
      eventId,
      update_at,
    } = request.body;

    const result = await runGoWorker("item-final-status", {
      allInventoryOfEvent: String(allInventoryOfEvent),
      eventId: String(eventId),
      groupingDevicesFromNoSQL: String(groupingDevicesFromNoSQL),
      update_at: String(update_at),
    });

    return response.status(201).json({
      affectedRows: result.affectedRows,
      msg: `Successfully updated ${result.affectedRows} items`,
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      msg: `${error.message}`,
      ok: false,
    });
  }
};

const consultingInventoryTracking = async (request, response) => {
  try {
    const connection = getConnection();
    const item_id = request.params.id;
    const query = `
    SELECT ii.* , iiae.status, iiae.condition, ei.*
    FROM item_inv ii
    LEFT JOIN item_inv_assigned_event iiae ON iiae.item_id = ii.item_id
    LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
    WHERE ii.item_id = ?
    ORDER by iiae.event_id DESC
    `;
    const values = [item_id];
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      result,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      msg: `${error.message}`,
      ok: false,
    });
  }
};

const checkingInventoryCurrentState = async (request, response) => {
  try {
    const company_id = request.params.company_id;

    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }
    // Scoped roles constrain the worker query to their locations/categories; a
    // scoped role with no assignments is denied (empty result, worker not called).
    const { payload, denyAll } = applyWorkerScope(userAccess, { company_id });
    if (denyAll) {
      return response.status(201).json({ ok: true, result: [] });
    }

    const workerResponse = await runGoWorker("checking-inventory-current-state", payload);
    if (workerResponse.status === "error") {
      throw new Error(workerResponse.message);
    }

    return response.status(201).json({ ok: true, result: workerResponse.data });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

const checkingItem = async (request, response) => {
  try {
    // Strip role/preference from body so they cannot influence the query
    const { role: _role, preference: _pref, ...bodyFilters } = request.body;

    // Validate required company_id
    if (!bodyFilters.company_id) {
      return response.status(400).json({
        msg: "company_id is required",
        ok: false,
      });
    }

    // Validate filters to prevent undefined values
    const cleanFilters = {};
    for (const [key, value] of Object.entries(bodyFilters)) {
      if (value !== undefined) {
        cleanFilters[key] = value;
      }
    }

    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, bodyFilters.company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }

    // Scoped roles constrain to their locations/categories; no assignments → denied.
    const { payload, denyAll } = applyWorkerScope(userAccess, { filters: cleanFilters });
    if (denyAll) {
      return response.status(201).json({ cached: false, items: [], ok: true });
    }

    const result = await runGoWorker("check-item", payload);

    return response.status(201).json({
      cached: false,
      items: result,
      ok: true,
    });
  } catch (error) {
    logger.error("checkingItem - Error:", error.message);
    return response.status(500).json({
      msg: `${error.message}`,
      ok: false,
    });
  }
};

const searchingInventoryTracking = async (request, response) => {
  try {
    const connection = getConnection();
    const { searchValue, company_id } = request.body;
    const query = `
    SELECT *
    FROM item_inv
    WHERE company_id = ?
    AND (
      category_name LIKE ?
      OR item_group LIKE ?
      OR serial_number LIKE ?
      OR warehouse LIKE ?
      OR descript_item LIKE ?
      OR status LIKE ?
      OR location LIKE ?
      OR brand LIKE ?
      OR ownership LIKE ?
      )
      ORDER BY serial_number ASC;
      `;
    const values = [
      company_id,
      `%${searchValue}%`,
      `%${searchValue}%`,
      `%${searchValue}%`,
      `%${searchValue}%`,
      `%${searchValue}%`,
      `%${searchValue}%`,
      `%${searchValue}%`,
      `%${searchValue}%`,
      `%${searchValue}%`,
    ];
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      result,
    });
  } catch (error) {
    response.status(500).json({
      error,
      msg: `Error: ${error.message}`,
      ok: false,
    });
  }
};

const searchingGetInventoryTracking = async (request, response) => {
  try {
    const connection = getConnection();
    const params = request._parsedUrl.query;
    const splitting = params.split("&");
    const query = `
    SELECT *
    FROM item_inv
    WHERE company_id = ?
    AND (
      category_name LIKE ?
      OR item_group LIKE ?
      OR serial_number LIKE ?
      OR warehouse LIKE ?
      OR descript_item LIKE ?
      OR status LIKE ?
      OR location LIKE ?
      OR brand LIKE ?
      )
      ORDER BY serial_number ASC;
      `;
    const searchingValue = [...splitting.map((item) => item.split("=")[1])];
    const values = [
      searchingValue[0],
      `%${searchingValue[1]}%`,
      `%${searchingValue[1]}%`,
      `%${searchingValue[1]}%`,
      `%${searchingValue[1]}%`,
      `%${searchingValue[1]}%`,
      `%${searchingValue[1]}%`,
      `%${searchingValue[1]}%`,
      `%${searchingValue[1]}%`,
    ];
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      result,
    });
  } catch (error) {
    response.status(500).json({
      error,
      msg: `Error: ${error.message}`,
      ok: false,
    });
  }
};

const fragmentData = async (request, response) => {
  try {
    const connection = getConnection();
    const params = request._parsedUrl.query;
    const company_id = new URLSearchParams(params).get("company_id");
    const offset = parseInt(new URLSearchParams(params).get("offset"), 10);
    const limit = parseInt(new URLSearchParams(params).get("limit"), 10);
    // const cache_connection = await clientRedis();
    // const cachedData = await cache_connection
    //   .promise()
    //   .get(`inventory_${company_id}_${offset}_${limit}`);

    // if (cachedData) {
    //   const responseTemplate = {
    //     ok: true,
    //     items: JSON.parse(cachedData),
    //     cached: true,
    //   };
    //   return response.send(JSON.stringify(responseTemplate));
    // }

    const query = `
      SELECT * FROM item_inv
      WHERE company_id = ?
      ORDER BY item_id ASC
      LIMIT ?
      OFFSET ?
    `;

    const values = [company_id, limit, offset];
    const [result] = await connection.execute(query, values);
    //   , function (err, result, fields) {
    //   if (err) {
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });
    //   }

    // });
    // cache_connection
    //   .promise()
    //   .set(
    //     `inventory_${company_id}_${offset}_${limit}`,
    //     JSON.stringify(result)
    //   );
    // cache_connection
    //   .promise()
    //   .expire(`inventory_${company_id}_${offset}_${limit}`, 120);

    return response.status(201).json({
      items: result,
      ok: true,
    });
  } catch (error) {
    const responseTemplate = {
      codeStatus: 500,
      error,
      msg: `Error: ${error.message}`,
      ok: false,
    };
    response.send(JSON.stringify(responseTemplate));
  }
};

const gettingDataFromLocationOption = async (request, response) => {
  try {
    const connection = getConnection();
    const params = request._parsedUrl.query;
    const company_id = new URLSearchParams(params).get("company_id");

    // Updated query to fetch from locations table and join with item_inv
    // This ensures locations without inventory are included
    const query = `
      SELECT 
        l.location_name as location, 
        sl.name as sub_location_name,
        COUNT(i.item_id) as total_count, 
        SUM(CASE WHEN i.warehouse = 0 and i.enableAssignFeature = 1 THEN 1 ELSE 0 END) as warehouse_true_count
      FROM locations l
      LEFT JOIN item_inv i ON l.location_id = i.location_id
      LEFT JOIN sub_locations sl ON i.sub_location_id = sl.sub_location_id
      WHERE l.company_id = ? AND l.status = 'active'
      GROUP BY l.location_id, l.location_name, sl.sub_location_id, sl.name
      ORDER BY l.location_name ASC, sl.name ASC
    `;

    const values = [company_id];

    // Execute the query
    const [result] = await connection.execute(query, values);

    // Format result to match previous output structure (if needed)
    // The previous output was just the result array, which is fine.
    // However, ensure null counts (from LEFT JOIN) are 0
    const formattedResult = result.map((row) => ({
      location: row.location,
      total_count: Number(row.total_count || 0),
      warehouse_true_count: Number(row.warehouse_true_count || 0),
    }));

    return response.status(201).json({
      cached: false,
      items: formattedResult,
      ok: true,
    });
  } catch (error) {
    const responseTemplate = {
      codeStatus: 500,
      error,
      msg: `Error: ${error.message}`,
      ok: false,
    };
    response.send(JSON.stringify(responseTemplate));
  }
};

const checkInventoryCompanyExists = async (request, response) => {
  try {
    const params = request._parsedUrl.query;
    const company_id = new URLSearchParams(params).get("company_id");
    const connection = getConnection();
    // const cache_connection = await clientRedis();
    // const cachedData = await cache_connection
    //   .promise()
    //   .get(`company_${company_id}_inventory_counting`);
    // if (cachedData) {
    //   cache_connection
    //     .promise()
    //     .del(`company_${company_id}_inventory_counting`);
    //   return response.json({
    //     statusCode: 200,
    //     ok: true,
    //     items: cachedData,
    //     cached: true,
    //   });
    // }
    const query = `
      SELECT COUNT(*)
      FROM item_inv
      WHERE company_id = ?
    `;
    const values = [company_id];
    const [result] = await connection.execute(query, values);
    // await cache_connection
    //   .promise()
    //   .set(`company_${company_id}_inventory_counting`, JSON.stringify(result));
    return response.json({
      cached: false,
      items: JSON.stringify(result),
      ok: true,
      statusCode: 200,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const containerItemsDetails = async (props) => {
  // getConnection() devuelve el Pool, que no expone beginTransaction/commit/
  // rollback — solo una PoolConnection individual los tiene.
  const pool = getConnection();
  const connection = await pool.getConnection();
  try {
    const removingItems =
      typeof props.remove === "string"
        ? JSON.parse(props.remove)
        : props.remove;
    const data =
      typeof props.data === "string" ? JSON.parse(props.data) : props.data;

    const removeIds = removingItems.map((item) => item.item_id).filter(Boolean);
    const addIds = data.map((item) => item.item_id).filter(Boolean);

    await connection.beginTransaction();

    // removing items from container — 1 UPDATE para todos en vez de 1 por item
    if (removeIds.length) {
      await connection.execute(
        `UPDATE item_inv
         SET container_id = ?, isItInContainer = ?, display_item = ?
         WHERE item_id IN (${removeIds.map(() => "?").join(",")})`,
        [null, 0, 1, ...removeIds]
      );
    }

    // adding new items to container — 1 UPDATE para todos en vez de 1 por item
    if (addIds.length) {
      await connection.execute(
        `UPDATE item_inv
         SET container_id = ?, isItInContainer = ?, display_item = ?
         WHERE item_id IN (${addIds.map(() => "?").join(",")})`,
        [props.container_id, 1, 0, ...addIds]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    logger.error("Error:", error);
    throw error;
  } finally {
    connection.release();
  }
};

const updateContentInContainerItem = async (request, response) => {
  try {
    const connection = getConnection();
    const { item_id, container_items, ref } = request.body;
    const query = `
      UPDATE item_inv
      SET container_items = ?
      WHERE item_id = ?;
    `;

    const values = [container_items, item_id];
    const [result] = await connection.execute(query, values);
    await containerItemsDetails({
      container_id: item_id,
      data: container_items,
      remove: ref,
    });
    return response.status(201).json({
      items: result,
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const updateItemInTableAfterBeingAddedToEventFromContainer = async (
  request,
  response,
) => {
  try {
    const connection = getConnection();
    const { refDatabase, warehouse } = request.body;
    const database =
      typeof refDatabase === "string" ? JSON.parse(refDatabase) : refDatabase;
    for (let item of database) {
      const query = `
        UPDATE item_inv 
        SET warehouse = ? AND update_at = NOW()
        WHERE item_id = ?;
      `;

      const values = [warehouse, item.item_id];

      await connection.execute(query, values);
    }
    return response.status(201).json({
      msg: "Items updated successfully in the warehouse",
      ok: true,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const checkingIfCompanyHasInventory = async (request, response) => {
  try {
    const params = request._parsedUrl.query;
    const splitting = params.split("&");
    const formatting = splitting.map((item) => item.split("=")[0] + "=?");
    const keys = formatting.toString().replaceAll(",", " AND ");
    const values = [...splitting.map((item) => item.split("=")[1])];
    const query = `select COUNT(*) as total from item_inv where ${keys};`;
    const connection = getConnection();
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      cached: false,
      ok: true,
      total: result[0].total,
    });
  } catch (error) {
    response.status(500).json({
      msg: `${error.message}`,
      ok: false,
    });
  }
};

const retrieveItemLocationQuantityForEvent = async (request, response) => {
  try {
    const connection = getConnection();
    const options = new Map();

    const invalidCols = Object.keys(request.body).filter((k) => !ITEM_INV_COLUMNS.has(k));
    if (invalidCols.length > 0) {
      return response.status(400).json({ ok: false, msg: `Invalid field(s): ${invalidCols.join(", ")}` });
    }
    const formatting = Object.keys(request.body)
      .map((item) => `\`${item}\`=?`)
      .join(" AND ");
    const values = Object.values(request.body);

    // 1. Summary query
    const summaryQuery = `
      SELECT 
        location, 
        COUNT(*) as qty, 
        MIN(serial_number) as min_serial, 
        MAX(serial_number) as max_serial
      FROM item_inv 
      WHERE ${formatting}
      GROUP BY location
    `;
    const [locationSummaries] = await connection.execute(summaryQuery, values);

    // Initialize options with summary info
    for (const summary of locationSummaries) {
      options.set(summary.location, {
        end: summary.max_serial,
        hasFullData: false,
        qty: summary.qty,
        serialNumberList: [],
        start: summary.min_serial,
      });
    }

    // 2. Serial numbers query
    const serialQuery = `
      SELECT location, serial_number
      FROM item_inv 
      WHERE ${formatting}
    `;
    const [serials] = await connection.execute(serialQuery, values);

    // Populate serialNumberList for each location
    for (const row of serials) {
      if (options.has(row.location)) {
        options.get(row.location).serialNumberList.push(row.serial_number);
      }
    }

    // 3. Enable compression if supported
    if (
      request.headers["accept-encoding"]?.includes("gzip") &&
      response.compress
    ) {
      response.setHeader("Content-Encoding", "gzip");
    }

    return response.status(200).json({
      cached: false,
      items: Object.fromEntries(options),
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const consultItemDataFromSerialNumber = async (request, response) => {
  try {
    const connection = getConnection();

    const {
      location,
      serial_number,
      quantity,
      company_id,
      warehouse = 1,
      item_group,
      category_name = null,
      enableAssignFeature = 1,
    } = request.body;

    if (!location || !quantity || !company_id || !item_group) {
      return response.status(400).json({
        msg: "Missing required parameters: location, quantity, company_id, item_group",
        ok: false,
      });
    }

    // Build base query and values
    let query = `
      SELECT *
      FROM item_inv
      WHERE 
        location = ? AND
        company_id = ? AND
        warehouse = ? AND
        item_group = ? AND
        enableAssignFeature = ?
    `;
    const values = [
      location,
      company_id,
      warehouse,
      item_group,
      enableAssignFeature,
    ];

    if (category_name) {
      query += ` AND category_name = ?`;
      values.push(category_name);
    }

    // Conditionally add serial_number filter if provided
    if (serial_number) {
      query += ` AND serial_number >= ?`;
      values.push(serial_number);
    }

    // Always order and limit
    query += ` ORDER BY serial_number ASC LIMIT ?`;
    values.push(quantity);

    const [results] = await connection.execute(query, values);

    return response.status(200).json({
      count: results.length,
      data: results,
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const getGroupedItemInventory = async (request, response) => {
  try {
    const connection = getConnection();

    const whereClauses = [];
    const values = [];
    const body = request.body || {};

    for (const [key, value] of Object.entries(body)) {
      if (value === null || value === undefined) continue;

      if (Array.isArray(value)) {
        if (value.length > 0) {
          const placeholders = value.map(() => '?').join(',');
          whereClauses.push(`${key} IN (${placeholders})`);
          values.push(...value);
        }
      } else {
        whereClauses.push(`${key} = ?`);
        values.push(value);
      }
    }

    const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : '';

    const query = `
      SELECT 
        category_name,
        item_group, 
        location, 
        COUNT(*) AS quantity
      FROM item_inv
      ${whereCondition}
      GROUP BY category_name, item_group, location
      ORDER BY category_name ASC, item_group ASC, location ASC
    `;

    const [rows] = await connection.execute(query, values);

    // Organize into nested structure: { category_name: { item_group: { location: quantity } } }
    const result = {};

    for (const row of rows) {
      const { category_name, item_group, location, quantity } = row;

      if (!result[category_name]) {
        result[category_name] = {};
      }

      if (!result[category_name][item_group]) {
        result[category_name][item_group] = {};
      }

      result[category_name][item_group][location] = Number(quantity);
    }

    return response.status(200).json({
      groupedInventory: result,
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const consultingCompanyInventoryWithPagination = async (request, response) => {
  try {
    const connection = getConnection();

    // Safe fallback for body
    const body =
      typeof request.body === "object" && request.body !== null
        ? request.body
        : {};
    const { lastItemId, direction = "forward" } = request.query;
    const pageSize = 10;

    // Filter non-undefined keys for WHERE clause
    const filterKeys = Object.keys(body).filter(
      (key) => body[key] !== undefined,
    );
    const filters =
      filterKeys.map((key) => `${key} = ?`).join(" AND ") || "1=1";
    const filterValues = filterKeys.map((key) => body[key]);

    // Cursor-based condition
    let cursorCondition = "";
    let cursorParams = [];

    if (lastItemId !== undefined && !isNaN(parseInt(lastItemId))) {
      cursorCondition =
        direction === "backward" ? " AND item_id < ?" : " AND item_id > ?";
      cursorParams.push(parseInt(lastItemId));
    }

    const sortOrder = direction === "backward" ? "DESC" : "ASC";

    // Final query
    const query = `
      SELECT * FROM item_inv
      WHERE ${filters}${cursorCondition}
      ORDER BY item_id ${sortOrder}
      LIMIT ?
    `;

    const queryValues = [...filterValues, ...cursorParams, pageSize].map((v) =>
      v === undefined ? null : v,
    );

    const [result] = await connection.execute(query, queryValues);

    return response.status(200).json({
      items: result,
      nextCursor: result.length > 0 ? result[result.length - 1].item_id : null,
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const buildSublocationQuery = (sublocationSegments = []) => {
  if (!sublocationSegments.length || sublocationSegments[0] === "null") {
    return {
      clause: "sub_location IS NULL",
      values: [],
    };
  }

  const clause = sublocationSegments
    .map((_, i) => `JSON_UNQUOTE(JSON_EXTRACT(sub_location, '$[${i}]')) = ?`)
    .join(" AND ");

  return {
    clause,
    values: sublocationSegments,
  };
};

const consultingCompanyInventoryBasedOnLocationAndSubLocation = async (
  request,
  response,
) => {
  try {
    const connection = getConnection();

    // Step 1: extract company filters
    const formattingKeys = Object.keys(request.body);
    const invalidCols = formattingKeys.filter((k) => !ITEM_INV_COLUMNS.has(k));
    if (invalidCols.length > 0) {
      return response.status(400).json({ ok: false, msg: `Invalid field(s): ${invalidCols.join(", ")}` });
    }
    const formatting = formattingKeys.map((item) => `\`${item}\`=?`).join(" AND ");
    const formattingValues = Object.values(request.body);
    const sublocationParam = request.query.sub_location || "null";
    // Step 2: extract sub_location path from query
    const sublocationSegments = sublocationParam.split(",").filter(Boolean);
    // Step 3: Final SQL
    let query = `
    SELECT * FROM item_inv
    WHERE ${formatting}
    `;
    const queryValues = [...formattingValues];
    if (sublocationSegments[0] !== "null") {
      // Fase 4a: si hay contexto de locación, resolvemos el path a ids del
      // subárbol y filtramos por la columna indexada sub_location_id (evita el
      // JSON_EXTRACT no-indexable). Si no hay location_id o el path no resuelve
      // completo contra sub_locations, caemos al filtro JSON legacy → sin
      // regresión (mismo comportamiento que antes).
      // El frontend real (LocationDetail/Table.jsx) manda `location` (nombre),
      // no `location_id` — se resuelve por nombre para que el fast-path aplique.
      let locationId = request.body.location_id;
      if (!locationId && request.body.company_id && request.body.location) {
        locationId = await getLocationId(connection, request.body.company_id, request.body.location);
      }
      let resolved = null;
      if (locationId) {
        resolved = await resolveSubLocationFilter(connection, locationId, sublocationSegments);
      }
      if (resolved && resolved.ids.length) {
        query += ` AND sub_location_id IN (${resolved.ids.map(() => "?").join(",")})`;
        queryValues.push(...resolved.ids);
      } else {
        const { clause, values } = buildSublocationQuery(sublocationSegments);
        query += ` AND ${clause}`;
        queryValues.push(...values);
      }
    }
    query += ` ORDER BY item_id ASC`;

    const [result] = await connection.execute(query, queryValues);
    return response.status(201).json({
      count: result.length,
      items: result,
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const getGroupedItemWithFormatInventory = async (request, response) => {
  try {
    const connection = getConnection();
    const { body } = request;

    // Build WHERE clause dynamically
    const conditions = [];
    const values = [];
    for (const [key, value] of Object.entries(body)) {
      if (value === null || value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        if (value.length > 0) {
          const placeholders = value.map(() => "?").join(", ");
          conditions.push(`${key} IN (${placeholders})`);
          values.push(...value);
        }
      } else {
        conditions.push(`${key} = ?`);
        values.push(value);
      }
    }
    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Dynamically build SELECT and GROUP BY based on location filter
    const hasLocationFilter =
      "location" in body &&
      body.location !== null &&
      body.location !== undefined &&
      (Array.isArray(body.location) ? body.location.length > 0 : body.location !== "");

    const selectFields = [
      "category_name",
      "item_group",
      "MIN(brand) AS brand",
      "MIN(descript_item) AS descript_item",
      "COUNT(*) AS quantity",
    ];
    const groupByFields = ["category_name", "item_group"];
    const orderByFields = ["category_name ASC", "item_group ASC"];

    if (hasLocationFilter) {
      selectFields.splice(2, 0, "location"); // Add location to SELECT
      groupByFields.push("location"); // Add location to GROUP BY
      orderByFields.push("location ASC"); // Add location to ORDER BY
    }

    // Construct the final query
    const query = `
      SELECT 
        ${selectFields.join(",\n        ")}
      FROM item_inv
      ${whereClause}
      GROUP BY 
        ${groupByFields.join(",\n        ")}
      ORDER BY 
        ${orderByFields.join(",\n        ")}
    `;

    const [rows] = await connection.execute(query, values);

    return response.status(200).json({
      groupedInventory: rows,
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

/**
 * Returns event devices to the warehouse and detaches them from the event, as
 * ONE atomic operation.
 *
 * The frontend does this today as three separate calls to the raw-SQL endpoint:
 * UPDATE item_inv SET warehouse = 1, then SELECT the item_ids, then DELETE the
 * event assignments. Split like that they are three independent transactions,
 * so a failure between the first and the last leaves stock marked as returned
 * to the warehouse while still assigned to the event — a state nothing later
 * reconciles.
 *
 * Two things make this safer than the sequence it replaces:
 *  - `FOR UPDATE` holds the matched rows for the life of the transaction, so a
 *    concurrent assignment cannot slip between the read and the writes.
 *  - The item_ids are derived HERE from company-scoped rows, instead of being
 *    supplied by the client. The legacy DELETE took item_ids straight from the
 *    browser and had no company filter of its own, so it could detach another
 *    tenant's assignments.
 */
const returnEventDevicesToWarehouse = async (request, response) => {
  const { event_id, item_group, category_name, serial_numbers } = request.body || {};

  if (!event_id || !item_group || !category_name) {
    return response.status(400).json({
      ok: false,
      msg: "event_id, item_group and category_name are required",
    });
  }

  const serials = [
    ...new Set(
      (Array.isArray(serial_numbers) ? serial_numbers : []).filter(
        (value) => value !== null && value !== undefined && String(value).trim() !== ""
      )
    ),
  ];
  if (!serials.length) {
    return response
      .status(400)
      .json({ ok: false, msg: "serial_numbers must be a non-empty array" });
  }

  const context = await resolveCompanyContext(request);
  if (!context.ok) {
    return response.status(context.status).json({ ok: false, msg: context.msg });
  }

  // getConnection() returns the Pool, which has no beginTransaction/commit —
  // only an individual PoolConnection does.
  const pool = getConnection();
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [items] = await connection.execute(
      `SELECT item_id FROM item_inv
        WHERE company_id = ? AND item_group = ? AND category_name = ?
          AND serial_number IN (${serials.map(() => "?").join(", ")})
        FOR UPDATE`,
      [context.companyId, item_group, category_name, ...serials]
    );

    if (!items.length) {
      await connection.rollback();
      return response.status(404).json({
        ok: false,
        msg: "No matching inventory items found for this company.",
      });
    }

    const itemIds = items.map((row) => row.item_id);
    const itemPlaceholders = itemIds.map(() => "?").join(", ");

    const [updated] = await connection.execute(
      `UPDATE item_inv SET warehouse = 1, update_at = NOW()
        WHERE company_id = ? AND item_id IN (${itemPlaceholders})`,
      [context.companyId, ...itemIds]
    );

    const [deleted] = await connection.execute(
      `DELETE FROM item_inv_assigned_event
        WHERE event_id = ? AND item_id IN (${itemPlaceholders})`,
      [event_id, ...itemIds]
    );

    await connection.commit();

    return response.status(200).json({
      ok: true,
      returned_items: updated.affectedRows,
      removed_assignments: deleted.affectedRows,
      // Serials that matched nothing in THIS company: either unknown, or owned
      // by another tenant. Reported rather than silently dropped, so the caller
      // can tell a partial result from a complete one.
      skipped_serials: serials.length - itemIds.length,
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        logger.error("returnEventDevicesToWarehouse rollback failed", {
          error: rollbackError.message,
        });
      }
    }
    logger.error("returnEventDevicesToWarehouse failed", {
      event_id,
      error: error.message,
    });
    return response.status(500).json({ ok: false, msg: error.message });
  } finally {
    connection.release();
  }
};

// Shapes already reported by THIS process. Each distinct shape is logged once
// rather than on every call, because the endpoint is high traffic and the goal
// is an inventory, not a request log. Under pm2 cluster each worker reports
// independently, which just means a shape can appear once per worker.
const reportedQueryShapes = new Set();

/**
 * Records the SHAPE of a client-supplied statement (never its values) so the
 * full set of queries the frontend sends can be inventoried before replacing
 * this endpoint with a server-side named-query catalog. Several frontend call
 * sites build their SQL in variables, so reading the client source is not
 * enough to enumerate them.
 *
 * Never throws: auditing must not be able to break the endpoint it observes.
 */
const auditRawQueryShape = (request, query) => {
  try {
    logger.info("raw-sql endpoint: auditing query shape", { query });
    logger.info("raw-sql endpoint: SQL_SHAPE_AUDIT", { value: process.env.SQL_SHAPE_AUDIT });
    if (process.env.SQL_SHAPE_AUDIT === "false") return;

    const described = describeSqlShape(query);
    logger.info("raw-sql endpoint: query shape observed", {
      shape_hash: described.hash,
      statement_type: described.type,
      tables: described.tables,
      has_company_id: described.hasCompanyId,
      mounted_at: request.baseUrl,
      sql_staff_id: request.sqlStaffId ?? null,
      shape: described.shape,
    });
    if (reportedQueryShapes.has(described.hash)) return;
    reportedQueryShapes.add(described.hash);

    logger.warn("raw-sql endpoint: new query shape observed", {
      shape_hash: described.hash,
      statement_type: described.type,
      tables: described.tables,
      // false => this shape cannot be scoped to the caller's company, so it
      // reads (or writes) across tenants. These are the priority cases for the
      // catalog.
      has_company_id: described.hasCompanyId,
      mounted_at: request.baseUrl,
      sql_staff_id: request.sqlStaffId ?? null,
      shape: described.shape,
    });
  } catch (auditError) {
    logger.error("raw-sql endpoint: shape audit failed", {
      error: auditError.message,
    });
  }
};

/**
 * Runs a statement from the server-side catalog. This is the replacement for
 * consultingCompanyInventoryBasedOnSubmittedParameters: the client names a
 * query and passes parameters, and the SQL text never leaves the server.
 *
 * The company id still arrives in the body (the frontend has it to hand), but
 * it is no longer TRUSTED: getStaffCompanyAccess resolves the caller's active
 * membership of that company and returns null otherwise, so a tampered value
 * yields 403 instead of another tenant's rows. That check is what closes the
 * cross-tenant hole in the legacy endpoint, where the company filter was
 * whatever the browser chose to send.
 */
const runNamedInventoryQuery = async (request, response) => {
  try {
    const { queryName, params } = request.body;

    if (!queryName) {
      return response.status(400).json({ ok: false, msg: "queryName is required" });
    }

    // Reads the s-company-lq header (or body/query for not-yet-migrated call
    // sites) and proves the caller belongs to that company. A header is client
    // input just like a body field, so the verification inside is what makes it
    // safe — not where the value was read from.
    const context = await resolveCompanyContext(request);
    if (!context.ok) {
      return response.status(context.status).json({ ok: false, msg: context.msg });
    }

    let built;
    try {
      built = buildNamedQuery(queryName, params, { companyId: context.companyId });
    } catch (paramError) {
      if (paramError instanceof QueryParamError) {
        return response.status(400).json({ ok: false, msg: paramError.message });
      }
      throw paramError;
    }

    const connection = getConnection();
    const [result] = await connection.execute(built.sql, built.values);

    return response.status(200).json({ ok: true, result });
  } catch (error) {
    logger.error("runNamedInventoryQuery failed", {
      queryName: request.body?.queryName,
      error: error.message,
    });
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingCompanyInventoryBasedOnSubmittedParameters = async (
  request,
  response,
) => {
  try {
    const connection = getConnection();
    let { query, values } = request.body;

    auditRawQueryShape(request, query);
    // Clone the values to safely manipulate
    let finalValues = [];
    let placeholderIndex = 0;

    // Replace all IN (?) with dynamic placeholders
    query = query.replace(/IN\s*\(\?\)/gi, () => {
      const val = values[placeholderIndex++];
      if (Array.isArray(val)) {
        // Push individual values into the final array
        finalValues.push(...val);
        // Return (?, ?, ?, ...) based on array length
        return `IN (${val.map(() => "?").join(", ")})`;
      } else {
        // Non-array, pass as-is
        finalValues.push(val);
        return "IN (?)";
      }
    });

    // Add remaining non-IN values
    for (; placeholderIndex < values.length; placeholderIndex++) {
      finalValues.push(values[placeholderIndex]);
    }
    const [result] = await connection.execute(query, finalValues);

    return response.status(200).json({
      ok: true,
      result,
    });
  } catch (error) {
    return response.status(500).json({
      err: JSON.stringify(error),
      msg: error.message,
      ok: false,
    });
  }
};

const retrieveItemData = async (request, response) => {
  try {
    const { company_id } = request.body;

    if (!company_id) {
      return response.status(400).json({ ok: false, msg: "company_id is required" });
    }

    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }
    // Scoped roles constrain to their locations/categories; no assignments → denied
    // (empty aggregation, worker not called).
    const { payload, denyAll } = applyWorkerScope(userAccess, { company_id });
    if (denyAll) {
      return response.status(200).json({
        args: [],
        groupedData: { category_name: {}, item_group: {}, brand: {}, ownership: {} },
        ok: true,
        query: "",
        total: 0,
        totalAvailable: 0,
      });
    }

    const result = await runGoWorker("retrieve-item-data", payload);
    return response.status(200).json({
      args: result.args,
      groupedData: result.groupedData,
      ok: true,
      query: result.query,
      total: result.total,
      totalAvailable: result.totalAvailable,
    });
  } catch (error) {
    return response.status(500).json({ msg: error.message, ok: false });
  }
};
const retrieveCompanyInventory = async (request, response) => {
  try {
    const connection = getConnection();
    const { company_id } = request.body;
    // Correct query to get the inventory items for the company
    const inventoryQuery = `
      SELECT *
      FROM item_inv
      WHERE company_id = ?
    `;

    const [items] = await connection.execute(inventoryQuery, [company_id]);
    // Prepare a map to store usage information for items with warehouse = 0
    const usageMap = new Map();

    // Collect item IDs with warehouse = 0
    const itemIds = items
      .filter((item) => item.warehouse === 0)
      .map((item) => item.item_id);
    if (itemIds.length > 0) {
      // Query to get usage information for items with warehouse = 0
      const usageQuery = `
        SELECT iiae.item_id, ei.event_name
        FROM item_inv_assigned_event iiae
        LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
        WHERE iiae.active = 1 AND iiae.item_id IN (${itemIds})
        order by iiae.event_id desc`;

      const [usageResults] = await connection.execute(usageQuery);
      // Assuming you have a usageResults array containing the usage information for items with warehouse = 0
      // Populate the usageMap with the results

      if (usageResults.length > 0) {
        usageResults.forEach((usage) => {
          if (!usageMap.has(usage.item_id)) {
            usageMap.set(usage.item_id, []);
          }
          usageMap.get(usage.item_id).push(usage.event_name);
        });
      }
    }

    // Attach usage information to items
    const itemsWithUsage = items.map((item) => {
      if (item.warehouse === 0) {
        return {
          brand: item.brand,
          category_name: item.category_name,
          enableAssignFeature: item.enableAssignFeature,
          image_url: item.image_url,
          item: item.item_id,
          item_group: item.item_group,
          location: item.location,
          main_warehouse: item.main_warehouse,
          ownership: item.ownership,
          serial_number: item.serial_number,
          status: item.status,
          usage: usageMap.has(item.item_id)
            ? usageMap.get(item.item_id)[0]
            : [],
          warehouse: item.warehouse,
        };
      }

      return {
        brand: item.brand,
        category_name: item.category_name,
        enableAssignFeature: item.enableAssignFeature,
        image_url: item.image_url,
        item: item.item_id,
        item_group: item.item_group,
        location: item.location,
        main_warehouse: item.main_warehouse,
        ownership: item.ownership,
        serial_number: item.serial_number,
        status: item.status,
        usage: [],
        warehouse: item.warehouse,
      };
    });

    return response.status(200).json({
      items: itemsWithUsage,
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const updateAllItemsInInventory = async (request, response) => {
  try {
    const {
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      warehouse,
      main_warehouse,
      update_at,
      location,
      current_location,
      sub_location,
      extra_serial_number,
      company_id,
      return_date,
      returnedRentedInfo,
      container,
      containerSpotLimit,
      display_item,
      enableAssignFeature,
      image_url,
      originalTemplate,
      supplier_info,
    } = request.body;
    const query = `
      select item_id from item_inv
      where company_id = ? and
      category_name = ? and
      item_group = ?;
    `;
    const values = [
      company_id,
      originalTemplate.category_name,
      originalTemplate.item_group,
    ];
    const [result] = await connection.execute(query, values);
    const itemIds = result.map((item) => item.item_id);
    const queryToUpdateParams = {
      brand: brand,
      category_name: category_name,
      container: container,
      containerSpotLimit: containerSpotLimit,
      cost: cost,
      current_location: current_location,
      descript_item: descript_item,
      display_item: display_item,
      enableAssignFeature: enableAssignFeature,
      extra_serial_number: extra_serial_number,
      image_url: image_url || null,
      item_group: item_group,
      location: location,
      main_warehouse: main_warehouse,
      ownership: ownership,
      return_date: return_date,
      returnedRentedInfo: returnedRentedInfo,
      sub_location: sub_location,
      supplier_info: supplier_info ?? null,
      update_at: update_at,
      warehouse: warehouse,
    };

    const keys = Object.keys(queryToUpdateParams);
    const updateQuery = `
      UPDATE item_inv SET ${keys.map((key) => `${key} = ?`).join(", ")} 
      WHERE item_id IN (${itemIds.map(() => "?").join(", ")})
    `;
    const sanitizedParams = keys.map((k) =>
      queryToUpdateParams[k] !== undefined ? queryToUpdateParams[k] : null,
    );
    const updateValues = [...sanitizedParams, ...itemIds];
    const [finalResult] = await connection.execute(updateQuery, updateValues);
    return response.status(200).json({
      msg: "Items updated successfully in the warehouse",
      ok: true,
      result: finalResult,
    });
  } catch (error) {
    return response.status(500).json({
      err: JSON.stringify(error),
      msg: error.message,
      ok: false,
    });
  }
};

const updateItemsBasedOnSerialNumber = async (request, response) => {
  try {
    const connection = getConnection();
    const {
      brand,
      category_name,
      container,
      containerSpotLimit,
      cost,
      current_location,
      descript_item,
      display_item,
      enableAssignFeature,
      extra_serial_number,
      image_url,
      item_group,
      location,
      main_warehouse,
      ownership,
      return_date,
      returnedRentedInfo,
      sub_location,
      warehouse,
      originalTemplate,
      supplier_info,
    } = request.body;
    if (!min_serial_number || !max_serial_number) {
      return response.status(400).json({
        msg: "Minimum and maximum serial numbers are required.",
        ok: false,
      });
    }
    const serialNumbers = [];
    let currentSerial = parseInt(min_serial_number, 10);
    const maxSerial = parseInt(max_serial_number, 10);

    while (currentSerial <= maxSerial) {
      serialNumbers.push(
        currentSerial.toString().padStart(min_serial_number.length, "0"),
      );
      currentSerial++;
    }
    const placeholders = serialNumbers.map(() => "?").join(",");
    const findQuery = `
      SELECT item_id FROM item_inv
      WHERE company_id = ? AND
            category_name = ? AND
            item_group = ? AND
            serial_number IN (${placeholders})
    `;

    const findValues = [
      company_id,
      originalTemplate.category_name,
      originalTemplate.item_group,
      ...serialNumbers,
    ];

    const [result] = await connection.execute(findQuery, findValues);
    const itemIds = result.map((item) => item.item_id);
    const queryToUpdateParams = {
      brand: brand,
      category_name: category_name,
      container: container,
      containerSpotLimit: containerSpotLimit,
      cost: cost,
      current_location: current_location,
      descript_item: descript_item,
      display_item: display_item,
      enableAssignFeature: enableAssignFeature,
      extra_serial_number: extra_serial_number,
      image_url: image_url,
      item_group: item_group,
      location: location,
      main_warehouse: main_warehouse,
      ownership: ownership,
      return_date: return_date,
      returnedRentedInfo: returnedRentedInfo,
      sub_location: sub_location,
      supplier_info: supplier_info || null,
      update_at: update_at,
      warehouse: warehouse,
    };

    const keys = Object.keys(queryToUpdateParams);
    const updateQuery = `
      UPDATE item_inv SET ${keys.map((key) => `${key} = ?`).join(", ")} 
      WHERE item_id IN (${itemIds.map(() => "?").join(", ")})
    `;
    const updateValues = [
      ...keys.map((k) => queryToUpdateParams[k]),
      ...itemIds,
    ];

    const [finalResult] = await connection.execute(updateQuery, updateValues);

    return response.status(200).json({
      msg: "Items updated successfully in the warehouse",
      ok: true,
      queryToUpdateParams,
      result: finalResult,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

// Migrado al contrato async (202 + jobId, ver DESIGN_task_queue.md § Fase 4b):
// el UPDATE corría síncrono dentro del ciclo request/response sosteniendo la
// conexión HTTP mientras tocaba potencialmente miles de filas (updateAll por
// criterio de category_name/item_group/brand, o listas grandes de seriales).
// Ahora el controller solo valida (rápido, sin DB) y encola; el UPDATE real
// vive en queue/handlers/inventoryBulkUpdateAlphanumeric.js dentro de una
// única transacción con conexión dedicada del pool.
const updateItemsBasedOnAlphanumericSerialNumber = createQueuedJobController(
  "inventory:bulk-update-alphanumeric",
  (body) => body,
  {
    validate: (body) => {
      const plan = resolveUpdatePlan(body);
      return plan.error ? { status: plan.error.status, body: { msg: plan.error.msg, ok: false } } : null;
    },
    buildSuccessBody: (job) => ({ msg: "Bulk item update queued", ok: true, jobId: job.id }),
  },
);

const insertContainerItems = async (request, response) => {
  const connection = getConnection();
  const { container_item_id, child_ids } = request.body;

  try {
    // Validate required fields
    if (
      !container_item_id ||
      !child_ids ||
      !Array.isArray(child_ids) ||
      child_ids.length === 0
    ) {
      return response.status(400).json({
        msg: "Container ID and at least one child ID are required",
        ok: false,
      });
    }

    // Validate container_item_id is a number
    if (!Number.isInteger(container_item_id)) {
      return response.status(400).json({
        msg: "Container ID must be an integer",
        ok: false,
      });
    }

    // Convert child_ids array to JSON string for storage
    const childIdsJson = JSON.stringify(child_ids);

    const query = `
      INSERT INTO container_items (container_item_id, child_ids)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
      child_ids = JSON_MERGE_PRESERVE(COALESCE(child_ids, JSON_ARRAY()), ?)
    `;

    const [results, err] = await connection.execute(query, [
      container_item_id,
      childIdsJson,
      childIdsJson,
    ]);

    if ((err, results.affectedRows === 0)) {
      logger.error("Error inserting container items:", err);
      return response.status(500).json({
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
        msg: "Error inserting container items",
        ok: false,
      });
    }
    return response.json({
      affected_rows: results.affectedRows,
      child_ids,
      container_item_id,
      msg: "Container items inserted successfully",
      ok: true,
    });
  } catch (error) {
    logger.error("Error in insertContainerItems:", error);
    return response.status(500).json({
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      msg: "Internal server error",
      ok: false,
    });
  }
};

const getContainerItems = async (request, response) => {
  const connection = getConnection();
  const { container_item_id } = request.params;

  try {
    // Validate input
    if (!container_item_id || isNaN(container_item_id)) {
      return response.status(400).json({
        msg: "Invalid container_item_id provided",
        ok: false,
      });
    }

    // First query to get container_items data
    const containerQuery =
      "SELECT container_item_id, child_ids FROM container_items WHERE container_item_id = ?";
    const [containerResults] = await connection.query(containerQuery, [
      container_item_id,
    ]);

    if (!containerResults.length) {
      return response.status(404).json({
        msg: "Container not found",
        ok: false,
      });
    }

    // Parse child_ids safely with string cleanup
    let childIds;
    try {
      const rawChildIds = containerResults[0].child_ids;
      //     // Remove any BOM or extra characters that might be present
      //     const cleanJson = rawChildIds?.replace(/^\ufeff/g, '').trim();
      childIds =
        typeof rawChildIds === "string" ? JSON.parse(cleanJson) : rawChildIds;

      if (!Array.isArray(childIds)) {
        // If it's not an array but a valid JSON, convert single value to array
        childIds = [childIds].filter((id) => id != null);
      }
    } catch (parseError) {
      logger.error(
        "Parse error details:",
        parseError,
        "\nRaw child_ids:",
        containerResults[0].child_ids,
      );
      return response.status(400).json({
        error: parseError.message,
        msg: "Invalid child_ids format in container",
        ok: false,
      });
    }

    if (childIds.length === 0) {
      return response.json({
        container: {
          container_item_id: parseInt(containerResults[0].container_item_id),
          child_ids: [],
          items: [],
        },
        ok: true,
      });
    }

    // Query to get items data
    const itemsQuery = `
            SELECT 
                brand,
                category_name,
                cost,
                current_location,
                descript_item,
                item_group,
                item_id,
                location,
                serial_number,
                warehouse
            FROM item_inv 
            WHERE item_id IN (?)
        `;
    const [itemsResults] = await connection.query(itemsQuery, [childIds]);
    // // Format response
    const containerData = {
      child_ids: childIds,
      container_item_id: parseInt(containerResults[0].container_item_id),
      items: itemsResults.map((item) => ({
        id: parseInt(item.item_id),
        brand: item.brand,
        category_name: item.category_name,
        cost: item.cost,
        descript_item: item.descript_item,
        item_group: item.item_group,
        item_id: parseInt(item.item_id),
        ownership: item.ownership,
        serial_number: item.serial_number,
      })),
    };

    return response.json({
      container: containerData,
      ok: true,
    });
  } catch (error) {
    logger.error("Error in getContainerItems:", error);
    return response.status(500).json({
      error: error.message,
      msg: "Error retrieving container items",
      ok: false,
    });
  }
};

const deleteContainerItem = async (request, response) => {
  const connection = getConnection();
  const { container_item_id } = request.params;

  try {
    // Validate input
    if (!container_item_id || isNaN(container_item_id)) {
      return response.status(400).json({
        msg: "Invalid container_item_id provided",
        ok: false,
      });
    }

    // Check if container exists before deletion
    const checkQuery =
      "SELECT container_item_id FROM container_items WHERE container_item_id = ?";
    const [checkResult] = await connection.query(checkQuery, [
      container_item_id,
    ]);

    if (!checkResult.length) {
      return response.status(404).json({
        msg: "Container not found",
        ok: false,
      });
    }

    // Delete the container
    const deleteQuery =
      "DELETE FROM container_items WHERE container_item_id = ?";
    const [deleteResult] = await connection.query(deleteQuery, [
      container_item_id,
    ]);

    if (deleteResult.affectedRows === 0) {
      return response.status(500).json({
        msg: "Failed to delete container",
        ok: false,
      });
    }

    return response.json({
      container_item_id: parseInt(container_item_id),
      msg: "Container deleted successfully",
      ok: true,
    });
  } catch (error) {
    logger.error("Error in deleteContainerItem:", error);
    return response.status(500).json({
      error: error.message,
      msg: "Error deleting container",
      ok: false,
    });
  }
};

const updateContainerItems = async (request, response) => {
  const connection = getConnection();
  const { container_item_id } = request.params;
  const { child_ids } = request.body;

  try {
    // Validate input
    if (!container_item_id || isNaN(container_item_id)) {
      return response.status(400).json({
        msg: "Invalid container_item_id provided",
        ok: false,
      });
    }

    if (!Array.isArray(child_ids)) {
      return response.status(400).json({
        msg: "child_ids must be an array",
        ok: false,
      });
    }

    // Check if container exists
    const checkQuery =
      "SELECT container_item_id FROM container_items WHERE container_item_id = ?";
    const [checkResult] = await connection.query(checkQuery, [
      container_item_id,
    ]);

    if (!checkResult.length) {
      return response.status(404).json({
        msg: "Container not found",
        ok: false,
      });
    }

    // Update container items
    const updateQuery =
      "UPDATE container_items SET child_ids = ? WHERE container_item_id = ?";
    const [updateResult] = await connection.query(updateQuery, [
      JSON.stringify(child_ids),
      container_item_id,
    ]);

    if (updateResult.affectedRows === 0) {
      return response.status(500).json({
        msg: "Failed to update container",
        ok: false,
      });
    }

    return response.json({
      container: {
        container_item_id: parseInt(container_item_id),
        child_ids: child_ids,
      },
      msg: "Container updated successfully",
      ok: true,
    });
  } catch (error) {
    logger.error("Error in updateContainerItems:", error);
    return response.status(500).json({
      error: error.message,
      msg: "Error updating container",
      ok: false,
    });
  }
};

// Security fix: item_ids used to be string-interpolated directly into the SQL
// (no parametrization, no type check) and the route had no auth/company
// scoping — any caller could read any company's inventory by item_id, and a
// non-numeric item_ids element would be injected raw into the query.
function createCheckLargeData({ connectionFn = getConnection } = {}) {
  return async function checkLargeData(request, response) {
    try {
      const { item_ids, company_id } = request.body;

      if (!company_id) {
        return response.status(400).json({
          msg: "company_id is required",
          ok: false,
        });
      }
      if (!Array.isArray(item_ids) || item_ids.length === 0) {
        return response.status(400).json({
          msg: "item_ids must be a non-empty array",
          ok: false,
        });
      }

      const connection = connectionFn();
      const placeholders = item_ids.map(() => "?").join(",");
      const query = `SELECT * FROM item_inv WHERE company_id = ? AND item_id IN (${placeholders})`;
      const [results] = await connection.execute(query, [company_id, ...item_ids]);

      return response.status(200).json({
        ok: true,
        result: results,
      });
    } catch (error) {
      logger.error("Error:", error.message);
      return response.status(500).json({
        msg: error.message,
        ok: false,
      });
    }
  };
}
const checkLargeData = createCheckLargeData();

// Security fix: the route had no auth/company scoping, and the SQL built by
// the Go worker had no company_id filter — any caller could bulk-update any
// company's inventory by item_id (item_id is a globally sequential,
// enumerable int, not scoped per company). company_id is now required here
// and forwarded to the Go worker, which adds `AND company_id = ?` to the
// UPDATE (see go-worker/controllers.go UpdateItemWarehouse).
//
// Pure "do the work" function — no req/res — so internal callers (ex.
// allocateDeviceToEvent in items_events.js) can call it directly instead of
// invoking the Express handler with a borrowed `response` object (that used
// to send multiple conflicting HTTP responses on the same connection).
// Throws an Error with `.statusCode` set for validation failures; the HTTP
// handler below maps that to the right response.
async function performUpdateLargeData({ item_ids, updates, company_id } = {}, { runGoWorkerFn = runGoWorker } = {}) {
  if (!company_id) {
    const err = new Error("company_id is required");
    err.statusCode = 400;
    throw err;
  }

  // Ensure item_ids is an array and not empty
  if (!Array.isArray(item_ids) || item_ids.length === 0) {
    const err = new Error("item_ids must be a non-empty array");
    err.statusCode = 400;
    throw err;
  }

  // Drop undefined values before checking "non-empty": a caller building
  // `updates: { logistic_status, warehouse }` from destructured fields that
  // turned out undefined would otherwise pass a technically non-empty object
  // (Object.keys still counts a key whose value is undefined) that then
  // serializes to `{}` over the wire to the Go worker (JSON.stringify drops
  // undefined-valued keys) — surfacing as a confusing "no update fields
  // provided" 500 from the Go worker instead of a clear 400 here.
  const definedUpdates = updates && typeof updates === "object"
    ? Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined))
    : {};

  if (Object.keys(definedUpdates).length === 0) {
    const err = new Error("'updates' must be a non-empty object");
    err.statusCode = 400;
    throw err;
  }

  return runGoWorkerFn("update-item-warehouse", {
    item_ids,
    updates: definedUpdates,
    company_id,
  });
}

function createUpdateLargeData({ runGoWorkerFn = runGoWorker } = {}) {
  return async function updateLargeData(request, response) {
    try {
      const result = await performUpdateLargeData(request.body, { runGoWorkerFn });
      return response.status(200).json({
        ok: true,
        result,
      });
    } catch (error) {
      logger.error("Error:", error.message);
      return response.status(error.statusCode || 500).json({
        msg: error.message,
        ok: false,
      });
    }
  };
}
const updateLargeData = createUpdateLargeData();

const updateSubLocation = async (req, res) => {
  try {
    const { newName, path, currentIndex, company_id } = req.body;

    // Validate required fields
    if (
      !newName ||
      !Array.isArray(path) ||
      currentIndex === undefined ||
      !company_id ||
      path.length === 0
    ) {
      return res.status(400).json({
        message:
          "Missing required fields: newName, path (array), currentIndex, and company_id",
        success: false,
      });
    }

    const connection = getConnection();

    // Handle location update (index 0)
    if (currentIndex === 0) {
      // Update locations table
      const updateLocationQuery = `
        UPDATE locations
        SET location_name = ?
        WHERE company_id = ? AND location_name = ?
      `;

      const [locResult] = await connection.query(updateLocationQuery, [
        newName,
        company_id,
        path[0],
      ]);

      // Backward compatibility: Update item_inv.location (string)
      const updateItemInvQuery = `
        UPDATE item_inv
        SET location = ?
        WHERE company_id = ? AND location = ?
      `;
      await connection.query(updateItemInvQuery, [
        newName,
        company_id,
        path[0],
      ]);

      return res.status(200).json({
        affectedRows: locResult.affectedRows,
        message: "Location updated successfully",
        ok: true,
      });
    }

    // Handle sub_location update (index > 0)
    // For relational structure, we need to find the specific sub_location record and update its name
    // The 'path' array represents the hierarchy: [Location, Sub1, Sub2, ...]

    // 1. Find the location_id
    const [locations] = await connection.query(
      "SELECT location_id FROM locations WHERE company_id = ? AND location_name = ?",
      [company_id, path[0]],
    );

    if (locations.length === 0) {
      return res.status(404).json({ message: "Location not found", ok: false });
    }
    const locationId = locations[0].location_id;

    // 2. Traverse the hierarchy to find the target sub_location_id
    // path: ["Building A", "Floor 3", "Room 101"]
    // currentIndex: 2 (updating "Room 101" to newName)
    // We need to find the ID of "Room 101" which is a child of "Floor 3", which is a child of "Building A"

    let currentParentId = null;
    let targetSubLocationId = null;

    // Iterate up to the target index
    for (let i = 1; i <= currentIndex; i++) {
      const nameToFind = path[i];

      let query =
        "SELECT sub_location_id FROM sub_locations WHERE location_id = ? AND name = ?";
      const params = [locationId, nameToFind];

      if (currentParentId === null) {
        query += " AND parent_id IS NULL";
      } else {
        query += " AND parent_id = ?";
        params.push(currentParentId);
      }

      const [subs] = await connection.query(query, params);

      if (subs.length === 0) {
        // If we can't find the path in relational table, we might need to fallback to JSON update or fail
        // For now, let's assume migration has run and fail if not found
        return res.status(404).json({
          message: `Sub-location segment '${nameToFind}' not found in relational structure`,
          ok: false,
        });
      }

      currentParentId = subs[0].sub_location_id;
      if (i === currentIndex) {
        targetSubLocationId = currentParentId;
      }
    }

    if (targetSubLocationId) {
      // Update the sub_locations table
      await connection.query(
        "UPDATE sub_locations SET name = ? WHERE sub_location_id = ?",
        [newName, targetSubLocationId],
      );
    }

    // Maintain Backward Compatibility: Update JSON in item_inv
    // This logic mimics the original JSON update behavior
    const updateIndex = currentIndex - 1;
    const pathConditions = path
      .slice(1)
      .map(
        (_, index) =>
          `JSON_UNQUOTE(JSON_EXTRACT(sub_location, '$[${index}]')) = ?`,
      )
      .join(" AND ");

    const updateQuery = `
      UPDATE item_inv
      SET sub_location = JSON_SET(
        sub_location,
        '$[${updateIndex}]',
        CAST(? AS JSON)
      )
      WHERE company_id = ? 
      AND location = ?
      ${pathConditions ? "AND " + pathConditions : ""}`;

    const [updateResult] = await connection.query(updateQuery, [
      JSON.stringify(newName),
      company_id,
      path[0],
      ...path.slice(1),
    ]);

    return res.status(200).json({
      affectedRows: updateResult.affectedRows,
      message: "Sub location updated successfully",
      ok: true,
    });
  } catch (error) {
    logger.error("Error updating sub location:", error);
    return res.status(500).json({
      error: error.message,
      message: "Internal server error while updating sub location",
      ok: false,
    });
  }
};

const getInventoryHierarchyWithTypes = async (request, response) => {
  try {
    const { company_id } = request.body;
    const connection = getConnection();
    if (!company_id) {
      return response.status(400).json({ msg: "company_id is required", ok: false });
    }

    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }
    let query = `
      SELECT
        item_id, item_group, warehouse, location, sub_location
      FROM item_inv
      WHERE company_id = ?
    `;

    const values = [company_id];

    // Full-access: unrestricted. Scoped roles: constrained to their locations/
    // categories; no assignments → matches nothing (1=0).
    const scope = buildInventoryScopeFilter(userAccess);
    if (scope.sql) {
      query += ` AND ${scope.sql}`;
      values.push(...scope.params);
    }

    const [items] = await connection.execute(query, values);

    // Group items by location
    const locationGroups = {};

    items.forEach((item) => {
      const location = item.location || "Unknown Location";

      if (!locationGroups[location]) {
        locationGroups[location] = [];
      }

      locationGroups[location].push({
        data: {
          item_group: item.item_group,
          sub_location:
            typeof item.sub_location === "string"
              ? JSON.parse(item.sub_location)
              : item.sub_location,
          warehouse: item.warehouse,
        },
      });
    });

    // Build hierarchical structure with types
    const result = {};

    for (const [location, items] of Object.entries(locationGroups)) {
      if (!result[location]) {
        result[location] = {
          available: 0,
          children: {},
          total: 0,
          types: [],
        };
      }

      // Collect unique item types for this location
      const locationTypes = new Set();

      for (const item of items) {
        const subLocArray = item?.data?.sub_location ?? [];
        const isAvailable = item?.data?.warehouse === 1;
        const itemType = item?.data?.item_group;

        if (itemType) locationTypes.add(itemType);

        // Main Location Count
        result[location].total = items.length;
        result[location].available = items.filter(
          (i) => i?.data?.warehouse === 1,
        ).length;

        // Walk through sub_location levels
        let pointer = result[location];

        for (const sub of subLocArray) {
          const subKey = sub || "null";

          if (!pointer.children[subKey]) {
            pointer.children[subKey] = {
              available: 0,
              children: {},
              total: 0,
              types: [],
            };
          }

          pointer.children[subKey].total += 1;
          if (isAvailable) pointer.children[subKey].available += 1;

          // Add item type to this sub-location
          if (itemType && !pointer.children[subKey].types.includes(itemType)) {
            pointer.children[subKey].types.push(itemType);
          }

          pointer = pointer.children[subKey];
        }
      }

      // Set types for main location
      result[location].types = Array.from(locationTypes);
    }

    // Recursively clean up children with no content and ensure types are properly set
    const cleanAndSetTypes = (node, parentItems = []) => {
      if (!node.children) return;

      for (const key in node.children) {
        cleanAndSetTypes(node.children[key]);
      }

      if (Object.keys(node.children).length === 0) {
        node.children = null;
      }
    };

    // Clean up the structure
    for (const location in result) {
      cleanAndSetTypes(result[location]);
    }

    return response.status(200).json({
      data: result,
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const getGroupedInventoryBySearchParameter = async (request, response) => {
  try {
    const connection = getConnection();
    const { company_id, searchParameter } = request.body;

    if (!company_id) {
      return response.status(400).json({
        msg: "company_id is required",
        ok: false,
      });
    }

    if (!searchParameter) {
      return response.status(400).json({
        msg: "searchParameter is required",
        ok: false,
      });
    }

    // Build dynamic search query
    let query = `
      SELECT 
        item_group, category_name, brand, ownership, location as main_location, warehouse
      FROM item_inv
      WHERE company_id = ?
    `;

    const queryParams = [company_id];

    // Add search conditions for category_name, item_group, or serial_number
    query += ` AND (
      category_name LIKE ? OR 
      item_group LIKE ? OR 
      serial_number LIKE ?
    )`;

    const searchPattern = `%${searchParameter}%`;
    queryParams.push(searchPattern, searchPattern, searchPattern);

    const [items] = await connection.execute(query, queryParams);

    // Initialize result structure
    const result = {
      brand: {},
      category_name: {},
      item_group: {},
      main_location: {},
      ownership: {},
    };

    // Process each item and group by different fields
    items.forEach((item) => {
      const isAvailable = item.warehouse === 1;

      // Group by item_group
      if (item.item_group) {
        if (!result.item_group[item.item_group]) {
          result.item_group[item.item_group] = {
            available: 0,
            total: 0,
          };
        }
        result.item_group[item.item_group].total += 1;
        if (isAvailable) result.item_group[item.item_group].available += 1;
      }

      // Group by category_name
      if (item.category_name) {
        if (!result.category_name[item.category_name]) {
          result.category_name[item.category_name] = {
            available: 0,
            total: 0,
          };
        }
        result.category_name[item.category_name].total += 1;
        if (isAvailable)
          result.category_name[item.category_name].available += 1;
      }

      // Group by brand
      if (item.brand) {
        if (!result.brand[item.brand]) {
          result.brand[item.brand] = {
            available: 0,
            total: 0,
          };
        }
        result.brand[item.brand].total += 1;
        if (isAvailable) result.brand[item.brand].available += 1;
      }

      // Group by ownership
      if (item.ownership) {
        if (!result.ownership[item.ownership]) {
          result.ownership[item.ownership] = {
            available: 0,
            total: 0,
          };
        }
        result.ownership[item.ownership].total += 1;
        if (isAvailable) result.ownership[item.ownership].available += 1;
      }

      // Group by main_location
      if (item.main_location) {
        if (!result.main_location[item.main_location]) {
          result.main_location[item.main_location] = {
            available: 0,
            total: 0,
          };
        }
        result.main_location[item.main_location].total += 1;
        if (isAvailable)
          result.main_location[item.main_location].available += 1;
      }
    });

    return response.status(200).json({
      data: result,
      ok: true,
      searchParameter,
      totalResults: items.length,
    });
  } catch (error) {
    return response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const filterSuppliersInfoItems = async (request, response) => {
  try {
    const connection = getConnection();
    const { company_id } = request.body;
    const query = `
      SELECT DISTINCT ii.supplier_info FROM item_inv ii
      WHERE ii.ownership = "Rent"
      AND ii.company_id = ?
      AND ii.supplier_info IS NOT NULL
      AND ii.supplier_info != ""
      AND ii.supplier_info != "null"
      ORDER BY ii.supplier_info ASC;
    `;
    const values = [company_id];
    const [result] = await connection.execute(query, values);

    // Additional filtering in case some empty values slip through
    const filteredResult = result.filter(
      (item) =>
        item.supplier_info &&
        item.supplier_info.trim() !== "" &&
        item.supplier_info !== "null" &&
        item.supplier_info !== "undefined",
    );

    return response.status(200).json({
      ok: true,
      result: filteredResult,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const deleteBulkItems = async (request, response) => {
  try {
    const { item_ids, company_id } = request.body;

    // Validate input
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return response.status(400).json({
        msg: "item_ids must be a non-empty array",
        ok: false,
      });
    }

    if (!company_id) {
      return response.status(400).json({
        msg: "company_id is required",
        ok: false,
      });
    }

    const userAccess = await getStaffCompanyAccess(request.sqlStaffId, company_id);
    if (!userAccess) {
      return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
    }

    // Process-only-permitted: for a scoped role, narrow item_ids to those whose own
    // location/category is within the staff's can_delete scope. Non-permitted ids are
    // silently skipped (reported via skipped_count). Full-access roles delete all.
    let targetIds = item_ids;
    let skippedCount = 0;
    if (userAccess.scoped) {
      const writable = await getWritableScope(userAccess, "delete");
      const permitted = new Set((writable.values || []).map(String));
      const connection = getConnection();
      // Batched: an unbounded IN (...) for the whole item_ids array risks
      // max_allowed_packet/parameter limits for a large delete request.
      const rows = [];
      for (const batch of chunkArray(item_ids, BULK_INSERT_BATCH_SIZE)) {
        const placeholders = batch.map(() => "?").join(",");
        const [batchRows] = await connection.execute(
          `SELECT item_id, location_id, category_name FROM item_inv
           WHERE company_id = ? AND item_id IN (${placeholders})`,
          [company_id, ...batch]
        );
        rows.push(...batchRows);
      }
      targetIds = rows
        .filter((r) =>
          permitted.has(String(writable.dimension === "location" ? r.location_id : r.category_name))
        )
        .map((r) => r.item_id);
      skippedCount = item_ids.length - targetIds.length;

      if (targetIds.length === 0) {
        return response.status(200).json({
          ok: true,
          result: { deleted_count: 0 },
          skipped_count: skippedCount,
          msg: "No items within your permitted scope",
        });
      }
    }

    const workerResponse = await runGoWorker("delete-bulk-items", {
      company_id: company_id,
      item_ids: targetIds,
    });

    if (workerResponse.status === "error") {
      throw new Error(workerResponse.message);
    }

    return response.status(200).json({
      ok: true,
      result: workerResponse.data,
      ...(skippedCount > 0 ? { skipped_count: skippedCount } : {}),
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      msg: error.message,
      ok: false,
    });
  }
};

const ensureIndexes = async (connection) => {
  try {
    const [idxCompany] = await connection.execute(
      "SELECT COUNT(1) AS cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'item_inv' AND index_name = 'idx_item_inv_company_id'",
    );
    if ((idxCompany[0]?.cnt ?? 0) === 0) {
      await connection.query(
        "CREATE INDEX idx_item_inv_company_id ON item_inv (company_id)",
      );
    }
    const [idxLocation] = await connection.execute(
      "SELECT COUNT(1) AS cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'item_inv' AND index_name = 'idx_item_inv_location'",
    );
    if ((idxLocation[0]?.cnt ?? 0) === 0) {
      await connection.query(
        "CREATE INDEX idx_item_inv_location ON item_inv (location)",
      );
    }
  } catch (e) {
    logger.warn("ensureIndexes error:", e.message);
  }
};

const retrieveCompanyItemsWithLocations = async (request, response) => {
  try {
    const connection = getConnection();
    const cache = await clientRedis();

    const { company_id, locations, limit, offset } = request.body;

    if (
      !company_id ||
      (typeof company_id !== "string" && typeof company_id !== "number")
    ) {
      return response
        .status(400)
        .json({ msg: "company_id is required", ok: false });
    }
    if (locations !== undefined && !Array.isArray(locations)) {
      return response
        .status(400)
        .json({ msg: "locations must be an array if provided", ok: false });
    }

    const lim = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const off = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const locs = Array.isArray(locations)
      ? locations.filter((l) => typeof l === "string" && l.trim() !== "")
      : [];

    const cacheKey = `items_company=${company_id}&locations=${locs.join(",")}&limit=${lim}&offset=${off}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      const payload = JSON.parse(cached);
      return response.status(200).json(payload);
    }

    await ensureIndexes(connection);

    let where = "company_id = ?";
    const args = [company_id];
    if (locs.length > 0) {
      where += ` AND location IN (${locs.map(() => "?").join(",")})`;
      args.push(...locs);
    }

    const [countRows] = await connection.execute(
      `SELECT COUNT(*) AS total FROM item_inv WHERE ${where}`,
      args,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [rows] = await connection.execute(
      `SELECT * FROM item_inv WHERE ${where} ORDER BY item_id ASC LIMIT ? OFFSET ?`,
      [...args, lim, off],
    );

    const payload = {
      cached: false,
      items: rows,
      metadata: { total, limit: lim, offset: off, returned: rows.length },
      ok: true,
    };

    await cache.set(cacheKey, JSON.stringify(payload));
    await cache.expire(cacheKey, 60);

    return response.status(200).json(payload);
  } catch (error) {
    logger.error("retrieveCompanyItemsWithLocations error:", error);
    return response.status(500).json({ msg: error.message, ok: false });
  }
};

const confirmItemsReturnedToStock = async (request, response) => {
  const connection = await getConnection().getConnection();
  try {
    const {
      serial_numbers,
      company_id,
      location,
      sub_location,
      noSqlCompanyId,
      noSqlEventName,
      user_id, // for logging
    } = request.body;

    // 1. Validation
    if (!Array.isArray(serial_numbers) || serial_numbers.length === 0) {
      return response
        .status(400)
        .json({ msg: "An array of serial numbers is required.", ok: false });
    }
    if (!company_id) {
      return response
        .status(400)
        .json({ msg: "SQL and NoSQL company IDs are required.", ok: false });
    }
    if (!noSqlEventName) {
      return response
        .status(400)
        .json({ msg: "noSqlEventName is required.", ok: false });
    }
    if (!user_id) {
      return response
        .status(400)
        .json({ msg: "user_id is required for logging.", ok: false });
    }

    await connection.beginTransaction();

    // 2. Update items in SQL database
    const subLocationString = Array.isArray(sub_location)
      ? JSON.stringify(sub_location)
      : sub_location;
    const updateQuery = `
      UPDATE item_inv
      SET warehouse = 1, main_warehouse= ?, location = ?, sub_location = ?, logistic_status = 'in-stock', update_at = NOW()
      WHERE company_id = ? AND serial_number IN (?);
    `;
    const [updateResult] = await connection.query(updateQuery, [
      location,
      location,
      subLocationString,
      company_id,
      serial_numbers,
    ]);

    // 3. Remove devices from the event pool in MongoDB
    const deletedPoolCount = await removePoolRecordsByCriteria({
      connection,
      eventSelected: noSqlEventName,
      nosql_company_id: noSqlCompanyId,
      serial_numbers,
      sql_company_id: company_id,
    });

    await connection.commit();

    return response.status(200).json({
      msg: `Updated ${updateResult.affectedRows} items to 'in_stock' and processed pool records.`,
      ok: true,
      pool_records_deleted: deletedPoolCount,
      sql_updated: updateResult.affectedRows,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    logger.error("Error confirming item return:", error.message);
    response.status(500).json({
      msg: error.message,
      ok: false,
    });
  } finally {
    if (connection) connection.release();
  }
};

// Migrado a cola (ver project_bulk_queue_migration_plan.md): sin
// serial_number, esto borra TODA una categoría/ubicación del inventario --
// sin techo natural, mismo perfil de riesgo que insertBulkItem/
// bulkReturnMemberLeases. El controller resuelve el scope (company_id +
// category_name/item_group, y los location_ids permitidos si el rol es
// location-scoped) y encola; el DELETE real vive en
// queue/handlers/deleteBulkItemBasedOnCriteria.js. Usa waitForJobOutcome
// para responder con la misma forma de siempre en el caso típico.
function createDeleteBulkItemBasedOnCriteria({
  getStaffCompanyAccessFn = getStaffCompanyAccess,
  getWritableScopeFn = getWritableScope,
  enqueueFn = enqueue,
  extractContextFn = extractJobContext,
  waitForJobOutcomeFn = waitForJobOutcome,
  maxWaitMs = 4000,
} = {}) {
  return async function deleteBulkItemBasedOnCriteria(request, response) {
    try {
      const { serial_number, category_name, item_group, company_id } = request.body;

      if (!company_id || !category_name) {
        return response.status(400).json({
          msg: "company_id and category_name are required.",
          ok: false,
        });
      }

      const userAccess = await getStaffCompanyAccessFn(request.sqlStaffId, company_id);
      if (!userAccess) {
        return response.status(403).json({ ok: false, msg: "Staff record not found for this company" });
      }

      // Intersect the delete criteria with the staff's can_delete scope. Category-scoped
      // roles: the fixed category_name must itself be permitted (all-or-nothing). Location-
      // scoped roles: the criteria carry no location, so restrict the DELETE to permitted
      // location_ids. Full-access roles are unrestricted.
      let location_ids = null;
      if (userAccess.scoped) {
        const writable = await getWritableScopeFn(userAccess, "delete");
        if (writable.dimension === "category") {
          if (!(writable.values || []).includes(category_name)) {
            return response.status(200).json({
              deleted_count: 0,
              msg: "Category not within your permitted scope. No changes were made.",
              ok: true,
            });
          }
        } else if (writable.dimension === "location") {
          if (!writable.values || writable.values.length === 0) {
            return response.status(200).json({
              deleted_count: 0,
              msg: "No locations within your permitted scope. No changes were made.",
              ok: true,
            });
          }
          location_ids = writable.values;
        }
      }

      const payload = { company_id, category_name, item_group, serial_number, location_ids };
      const job = await enqueueFn("inventory:bulk-delete-by-criteria", payload, {
        context: extractContextFn(request),
      });

      const outcome = await waitForJobOutcomeFn(job, { maxWaitMs });
      if (outcome.outcome === "done") {
        const { deletedCount } = outcome.result;
        if (deletedCount === 0) {
          return response.status(200).json({
            deleted_count: 0,
            msg: "No items found matching the provided criteria. No changes were made.",
            ok: true,
          });
        }
        return response.status(200).json({
          deleted_count: deletedCount,
          msg: `${deletedCount} item(s) deleted successfully.`,
          ok: true,
        });
      }
      if (outcome.outcome === "failed") {
        return response.status(500).json({
          error: outcome.job.lastError,
          msg: "An internal error occurred. Please contact the administrator.",
          ok: false,
        });
      }
      return response.status(202).json({
        ok: true,
        jobId: job.id,
        msg: "Request queued — still processing. Poll GET /api/jobs/owned/:jobId for the result.",
      });
    } catch (error) {
      logger.error("deleteBulkItemBasedOnCriteria error:", error);
      return response.status(500).json({
        error: error.message,
        msg: "An internal error occurred. Please contact the administrator.",
        ok: false,
      });
    }
  };
}
const deleteBulkItemBasedOnCriteria = createDeleteBulkItemBasedOnCriteria();

const retrieveCompanyInventoryBasedOnParams = async (request, response) => {
  const { expected, company_id, location, item_group, category_name, limit } = request.body;
  const connection = getConnection();
  if (!company_id || !location) {
    return response.status(400).json({
      message: "company_id and location are required.",
      ok: false,
    });
  }
  const query = `
    SELECT ${expected || '*'} FROM item_inv
    WHERE company_id = ? AND location = ?
    ${item_group ? 'AND item_group = ?' : ''}
    ${category_name ? 'AND category_name = ?' : ''}
    ${limit ? 'LIMIT ?' : ''}
  `;
  const values = [company_id, location, ...(item_group ? [item_group] : []), ...(category_name ? [category_name] : []), ...(limit ? [limit] : [])];
  try {
    const [result] = await connection.execute(query, values);
    return response.status(200).json({
      items: result,
      mapped_result: JSON.stringify(result.map(item => item.item_id)),
      ok: true,
    });
  } catch (error) {
    logger.error("Error retrieving company inventory:", error.message);
    return response.status(500).json({
      error: error.message || "An internal error occurred while retrieving items.",
      ok: false,
    });
  }
}

module.exports = {
  checkingIfCompanyHasInventory,
  checkingInventoryCurrentState,
  checkingItem,
  checkInventoryCompanyExists,
  checkLargeData,
  createCheckLargeData,
  createUpdateLargeData,
  performUpdateLargeData,
  confirmItemsReturnedToStock,
  containerItemsDetails,
  consultingCompanyInventoryBasedOnLocationAndSubLocation,
  consultingCompanyInventoryBasedOnSubmittedParameters,
  runNamedInventoryQuery,
  returnEventDevicesToWarehouse,
  consultingCompanyInventoryWithPagination,
  consultingInventoryTracking,
  consultingItem,
  consultingItemInWarehouseTable,
  consultingItemTable,
  consultItemDataFromSerialNumber,
  deleteBulkItemBasedOnCriteria,
  createDeleteBulkItemBasedOnCriteria,
  deleteBulkItems,
  deleteContainerItem,
  deleteItem,
  filterSuppliersInfoItems,
  fragmentData,
  getContainerItems,
  getGroupedInventoryBySearchParameter,
  getGroupedItemInventory,
  getGroupedItemWithFormatInventory,
  getInventoryHierarchyWithTypes,
  gettingDataFromLocationOption,
  insertBulkItem,
  createInsertBulkItemRange,
  insertBulkItemAlhpanumericFormat,
  createInsertBulkItemAlphanumeric,
  insertContainerItems,
  insertingItem,
  itemFinalStatusWhenEventIsFinished,
  itemFinalStatusWhenEventIsFinishedRefactored,
  retrieveCompanyInventory,
  retrieveCompanyInventoryBasedOnParams,
  retrieveCompanyItemsWithLocations,
  retrieveItemData,
  retrieveItemLocationQuantityForEvent,
  returningItemToStockWhenEventIsFinished,
  returningItemToStockWhenEventIsFinishedRefactored,
  returningLeasedEquipmentToCompany,
  searchingGetInventoryTracking,
  searchingInventoryTracking,
  updateAllItemsInInventory,
  updateContainerItems,
  updateContentInContainerItem,
  updateItemInTable,
  updateItemInTableAfterBeingAddedToEventFromContainer,
  updateItemInWarehouseAfterBeingAddedToEvent,
  updateItemsBasedOnAlphanumericSerialNumber,
  updateItemsBasedOnSerialNumber,
  updateLargeData,
  updateSubLocation,
};