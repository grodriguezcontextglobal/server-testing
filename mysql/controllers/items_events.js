require("dotenv").config();
const logger = require("../../helpers/logger");
const getConnection = require("../database/config");

const connection = getConnection();

const insertingItemInEvent = async (request, response) => {
  try {
    const { event_id, item_group, category_name, company_id, data } = request.body;

    if (!event_id || !item_group || !category_name || !company_id || !Array.isArray(data) || data.length === 0) {
      return response.status(400).json({ ok: false, msg: "Missing required fields or invalid data format" });
    }

    const serialNumbers = data.map((item) => item.toString());
    const placeholders = serialNumbers.map(() => "?").join(",");
    const findIndexQuery = `
      SELECT item_id, serial_number FROM item_inv
      WHERE item_group = ? AND category_name = ? AND company_id = ? AND serial_number IN (${placeholders})`;
    const findIndexValues = [item_group, category_name, company_id, ...serialNumbers];

    const [results] = await connection.execute(findIndexQuery, findIndexValues);

    if (!results.length) {
      return response.status(404).json({ ok: false, msg: "No matching items found" });
    }

    const insertQuery = `INSERT INTO item_inv_assigned_event (item_id, event_id) VALUES ?`;
    const insertValues = results.map((item) => [item.item_id, event_id]);

    const [insertResult] = await connection.query(insertQuery, [insertValues]);

    response.status(201).json({
      ok: true,
      msg: "Items inserted successfully into event",
      inserted_items: insertResult.affectedRows,
      total_items: results.length,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const insertingDeviceInEventDirectly = async (request, response) => {
  try {
    const { item_id, event_id } = request.body;
    const insertQuery = `INSERT INTO item_inv_assigned_event (item_id, event_id) VALUES (?, ?)`;
    const values = [item_id, event_id];

    const [result] = await connection.execute(insertQuery, values);

    response.status(201).json({
      ok: true,
      msg: "Item inserted successfully into event",
      inserted_items: result.affectedRows,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const deletingItemsInEventAfterDeviceInventoryIsUpdated = async (request, response) => {
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
    const formatting = Object.keys(request.body).map((item) => item + "=?").join(" AND ");
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
    const splitting = params.split("&");
    const formatting = splitting.map((item) => item.split("=")[0] + "=?").join(" AND ");
    const values = splitting.map((item) => item.split("=")[1]);

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

    const [result] = await connection.execute(query, [item_id, company_assigned_event_id]);
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

const insertingDeviceInEventDirectlyFromContainer = async (request, response) => {
  try {
    const { refDatabase, event_id } = request.body;
    const database = typeof refDatabase === "string" ? JSON.parse(refDatabase) : refDatabase;

    const insertQuery = `INSERT INTO item_inv_assigned_event (item_id, event_id) VALUES (?, ?)`;

    for (const item of database) {
      await connection.execute(insertQuery, [item.item_id, event_id]);
    }

    response.status(201).json({ ok: true, msg: "Items inserted successfully into event" });
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
      return response.status(400).json({ ok: false, msg: "No filters provided in request.body" });
    }

    // Guard against SQL injection via column names; allow typical identifier characters
    const validKeys = keys.filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
    if (validKeys.length === 0) {
      return response.status(400).json({ ok: false, msg: "No valid filter keys provided" });
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
};
