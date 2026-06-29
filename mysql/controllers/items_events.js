require("dotenv").config();
const logger = require("../../helpers/logger");
const getConnection = require("../database/config");
const { groupBy } = require("lodash");
const connection = getConnection();
const { getStaffCompanyAccess, FULL_INVENTORY_ROLES } = require("../helpers/staffAccess");

const runGoWorker = require("../../helpers/goWorker");
const { updateLargeData } = require("./item");
const {
  poolReceiversBulk: poolReceiversBulkWorker,
} = require("../../controller/receiverWorker");
const insertingItemInEvent = async (request, response) => {
  try {
    const { event_id, item_group, category_name, company_id, data } =
      request.body;
    if (
      !event_id ||
      !item_group ||
      !category_name ||
      !company_id ||
      !Array.isArray(data) ||
      data.length === 0
    ) {
      return response.status(400).json({
        msg: "Missing required fields or invalid data format",
        ok: false,
      });
    }

    // Convert data to string array as Go worker expects
    const serialNumbers = data.map((item) => item.toString());

    // Offload to Go Worker
    const result = await runGoWorker("insert-item-event", {
      category_name,
      company_id: String(company_id),
      data: serialNumbers,
      event_id: String(event_id),
      item_group,
    });

    response.status(201).json({
      inserted_items: result.inserted_items,
      msg: "Items inserted successfully into event",
      ok: true,
      total_items: result.total_items,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

const bulkUpdateEventItemShipping = async (request, response) => {
  let connection;
  try {
    const { company_id, event_id, updates, filters } = request.body;

    if (!company_id || !event_id) {
      return response.status(400).json({
        message: "company_id and event_id are required.",
        ok: false,
      });
    }
    if (!updates || Object.keys(updates).length === 0) {
      return response.status(400).json({
        message: "At least one update field must be provided.",
        ok: false,
      });
    }
    if (!filters || Object.keys(filters).length === 0) {
      return response.status(400).json({
        message: "At least one filter condition must be provided.",
        ok: false,
      });
    }

    const allowedFields = ["shipping_status", "active", "notes"];
    const fieldsToUpdate = Object.keys(updates).filter(field => allowedFields.includes(field));
    const filterKeys = Object.keys(filters).filter(field => allowedFields.includes(field));

    if (fieldsToUpdate.length === 0) {
      return response.status(400).json({
            message: `No valid fields to update. Allowed fields are: ${allowedFields.join(", ")}`,
            ok: false,
        });
    }
     if (filterKeys.length === 0) {
      return response.status(400).json({
            message: `No valid filter fields provided. Allowed fields are: ${allowedFields.join(", ")}`,
            ok: false,
        });
    }

    connection = await getConnection().getConnection();
    await connection.beginTransaction();

    const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(", ");
    const updateValues = fieldsToUpdate.map(field => updates[field]);

    const whereConditions = filterKeys.map(key => `${key} = ?`);
    const filterValues = filterKeys.map(key => filters[key]);
    
    const query = `
      UPDATE event_item_shipping
      SET ${setClause}
      WHERE event_id = ? AND company_id = ? AND ${whereConditions.join(" AND ")};
    `;

    const queryParams = [...updateValues, event_id, company_id, ...filterValues];
    const [result] = await connection.query(query, queryParams);
    
    await connection.commit();

    return response.status(200).json({
      message: `${result.affectedRows} item(s) have been updated for event ${event_id}.`,
      ok: true,
      total_updated: result.affectedRows,
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    logger.error("Error during bulk update of event items:", error.message);
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
    const formatting = Object.keys(request.body)
      .map((item) => item + "=?")
      .join(" AND ");
    const values = Object.values(request.body);
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
      WHERE ii.${formatting};`;

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
    const { role_level, locations } = userAccess;

    let formatting = filters.join(" AND ");

    if (!FULL_INVENTORY_ROLES.has(role_level) && locations.length > 0) {
      const locPlaceholders = locations.map(() => "?").join(",");
      formatting += ` AND ii.location IN (${locPlaceholders})`;
      values.push(...locations);
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

const insertingDeviceInEventDirectlyFromContainer = async (
  request,
  response,
) => {
  try {
    const { refDatabase, event_id } = request.body;

    // Parse refDatabase if string, else use as is
    // Node.js logic handles both string and object. Go worker will need a structure.
    // If it's a string, we can pass it as is. If object, pass as is.

    // Offload to Go Worker
    await runGoWorker("insert-device-event-container", {
      event_id: String(event_id),
      refDatabase,
    });

    response
      .status(201)
      .json({ msg: "Items inserted successfully into event", ok: true });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ msg: error.message, ok: false });
  }
};

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

const allocateDeviceToEvent = async (request, response) => {
  try {
    const { item_group, company_id, category_name, data, warehouse, logistic_status } =
      request.body;
    if (!data || data.length === 0) {
      return response.status(400).json({
        message: "No items were provided to be allocated to the event.",
        ok: false,
      });
    }
    const connection = getConnection();
    const placeholders = data.map(() => "?").join(",");
    const query = `SELECT item_id from item_inv 
                   where company_id = ? AND item_group = ? 
                   AND category_name = ? 
                   AND serial_number IN (${placeholders})`;
    const values = [company_id, item_group, category_name, ...data];
    const [result] = await connection.execute(query, values);
    logger.info("result", result)
    if (result.length > 0) {
      //call controller to insert item into event inventory sql
      const itemIdsForUpdateLargeData = {
        body: {
          item_ids: [...result.map((item) => item.item_id)],
          updates:{
            logistic_status: logistic_status,
            warehouse: warehouse,
          }
        },
      };
      const update = await updateLargeData(itemIdsForUpdateLargeData, response);
      const insertedItemInEvent = await insertingItemInEvent(request, response);
      response.status(200).json({
        bodyForUpdate: itemIdsForUpdateLargeData,
        inserted: insertedItemInEvent,
        ok: true,
        result,
        updateResult: update,
      });
    } else {
      response.status(500).json({
        msg: "No items to allocate",
        ok: false
      })
    }
  } catch (error) {
    response.status(500).json({
      error: error.message,
      ok: false,
    });
  }
};

const allocateDeviceMarkedAsContainerInEvent = async (request, response) => {
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

    connection = await getConnection().getConnection();
    await connection.beginTransaction();

    const placeholders = data.map(() => "?").join(",");
    const containerQuery = `
      SELECT ii.item_id, ci.child_ids
      FROM container_items ci
      JOIN item_inv ii ON ii.item_id = ci.container_item_id
      WHERE ii.serial_number IN (${placeholders})
        AND ii.company_id = ?;
    `;

    const [containers] = await connection.execute(containerQuery, [
      ...data,
      company_id,
    ]);

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
    const allItemsPlaceholder = allItemsToProcess.map(() => "?").join(",");

    const updateQuery = `
      UPDATE item_inv
      SET warehouse = ?, logistic_status = ?
      WHERE company_id = ?
        AND item_id IN (${allItemsPlaceholder});
    `;
    await connection.execute(updateQuery, [warehouse, logistic_status, company_id, ...allItemsToProcess]);

    const insertPlaceholders = allItemsToProcess.map(() => "(?, ?)").join(", ");
    const insertQuery = `
      INSERT IGNORE INTO item_inv_assigned_event (event_id, item_id)
      VALUES ${insertPlaceholders};
    `;
    const insertValues = allItemsToProcess.flatMap((id) => [event_id, id]);
    await connection.execute(insertQuery, insertValues);

    // Build props only for children (the receivers inside the container)
    let resultProps = [];
    if (childItemIds.length > 0) {
      const placeholderChildren = childItemIds.map(() => "?").join(",");
      const queryToPassAsPropsQuery = `
        SELECT item_group, category_name, serial_number
        FROM item_inv
        WHERE company_id = ?
          AND item_id IN (${placeholderChildren});
      `;
      const [rows] = await connection.execute(queryToPassAsPropsQuery, [
        company_id,
        ...childItemIds,
      ]);
      resultProps = rows;
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
      await poolReceiversBulkWorker(poolPayload);
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