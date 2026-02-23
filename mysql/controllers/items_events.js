require("dotenv").config();
const logger = require("../../helpers/logger");
const getConnection = require("../database/config");

const connection = getConnection();

const runGoWorker = require("../../helpers/goWorker");
const { updateLargeData } = require("./item");

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
        ok: false,
        msg: "Missing required fields or invalid data format",
      });
    }

    // Convert data to string array as Go worker expects
    const serialNumbers = data.map((item) => item.toString());

    // Offload to Go Worker
    const result = await runGoWorker("insert-item-event", {
      event_id: String(event_id),
      item_group,
      category_name,
      company_id: String(company_id),
      data: serialNumbers,
    });

    response.status(201).json({
      ok: true,
      msg: "Items inserted successfully into event",
      inserted_items: result.inserted_items,
      total_items: result.total_items,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const insertingDeviceInEventDirectly = async (request, response) => {
  try {
    const { item_id, event_id } = request.body;

    // Offload to Go Worker (via HTTP, no process spawning per request)
    const result = await runGoWorker("insert-device-event-directly", {
      item_id,
      event_id: String(event_id),
    });

    response.status(201).json({
      ok: true,
      msg: "Item inserted successfully into event",
      inserted_items: result.inserted_items || 0,
    });
  } catch (error) {
    logger.error("Error inserting device directly:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
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
      ok: true,
      msg: "Items deleted successfully from event",
      deleted_items: result.affectedRows,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
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
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const checkingInventoryCurrentState = async (request, response) => {
  try {
    const params = request._parsedOriginalUrl.query;
    const splitting = params ? params.split("&") : [];

    let role = null;
    let preference = null;
    const filters = [];
    const values = [];

    splitting.forEach((item) => {
      const [key, value] = item.split("=");
      if (key === "role") {
        role = value;
      } else if (key === "preference") {
        try {
          preference = JSON.parse(decodeURIComponent(value));
        } catch (e) {
          preference = value;
        }
      } else if (key) {
        filters.push(`ii.${key}=?`);
        values.push(value);
      }
    });

    let formatting = filters.join(" AND ");

    let locations = [];
    if (Array.isArray(preference)) {
      locations = preference;
    } else if (preference && preference.inventory_location) {
      locations = preference.inventory_location;
    }

    if (role !== "0" && role !== "1" && locations.length > 0) {
      const locPlaceholders = locations.map(() => "?").join(",");
      if (formatting) {
        formatting += ` AND ii.location IN (${locPlaceholders})`;
      } else {
        formatting = `ii.location IN (${locPlaceholders})`;
      }
      values.push(...locations);
    }

    // Fallback to 1=1 if no filters to avoid SQL syntax error
    if (!formatting) {
      formatting = "1=1";
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
    response.status(500).json({ ok: false, msg: error.message });
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
    response.status(500).json({ ok: false, msg: error.message });
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
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const deletingRecordInItemInvAssignedEventRow = async (request, response) => {
  try {
    const { event_id, item_id } = request.body;
    const query = `DELETE FROM item_inv_assigned_event WHERE event_id = ? AND item_id = ?`;

    const [result] = await connection.execute(query, [event_id, item_id]);
    response.status(200).json({
      ok: true,
      msg: "Item deleted successfully from event",
      deleted_items: result.affectedRows,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
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
      refDatabase,
      event_id: String(event_id),
    });

    response
      .status(201)
      .json({ ok: true, msg: "Items inserted successfully into event" });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingLeaseInformationConsumer = async (request, response) => {
  try {
    const body = request.body || {};
    const keys = Object.keys(body);

    if (keys.length === 0) {
      return response
        .status(400)
        .json({ ok: false, msg: "No filters provided in request.body" });
    }

    // Guard against SQL injection via column names; allow typical identifier characters
    const validKeys = keys.filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
    if (validKeys.length === 0) {
      return response
        .status(400)
        .json({ ok: false, msg: "No valid filter keys provided" });
    }

    const formatting = validKeys.map((k) => `\`${k}\`=?`).join(" AND ");
    const values = validKeys.map((k) => body[k]);

    const query = `SELECT * FROM lease_customer_info WHERE ${formatting}`;
    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, result });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const allocateDeviceToEvent = async (request, response) => {
  try {
    const {item_group, company_id, category_name, data, warehouse } =
      request.body;
    if (!data || data.length === 0) {
      return response.status(400).json({
        ok: false,
        message: "No items were provided to be allocated to the event.",
      });
    }
    const connection = getConnection();
    const placeholders = data.map(() => "?").join(",");
    const query = `SELECT item_id from item_inv where company_id = ? AND item_group = ? AND category_name = ? AND warehouse = 1 AND serial_number IN (${placeholders})`;
    const values = [company_id, item_group, category_name, ...data];
    const [result] = await connection.execute(query, values);
    if(result){

    }
    //call controller to insert item into event inventory sql
    const itemIdsForUpdateLargeData = {
      body:{
        item_ids:[ ...result.map(item => item.item_id)], warehouse:warehouse
      }
    }
    const update = await updateLargeData(itemIdsForUpdateLargeData, response)
    const insertedItemInEvent = await insertingItemInEvent(request, response);
    response.status(200).json({
      ok: true,
      result,
      bodyForUpdate: itemIdsForUpdateLargeData,
      updateResult: update,
      inserted:insertedItemInEvent
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

module.exports = {
  insertingItemInEvent,
  consultingInventoryCurrentState,
  consultingInventoryInEvent,
  deletingItemsInEventAfterDeviceInventoryIsUpdated,
  consultingRowInItemInvAssignedEventTable,
  deletingRecordInItemInvAssignedEventRow,
  insertingDeviceInEventDirectly,
  checkingInventoryCurrentState,
  insertingDeviceInEventDirectlyFromContainer,
  consultingLeaseInformationConsumer,
  allocateDeviceToEvent,
};
