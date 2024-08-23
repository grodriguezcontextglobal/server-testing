require("dotenv").config();
const { response } = require("express");
const getConnection = require("../database/config");

const connection = getConnection();

const insertingItemInEvent = async (request, response) => {
  try {
    const { startingNumber, quantity, event_id, item_group, category_name } =
      request.body;
    // Validate request body
    if (
      !startingNumber ||
      !quantity ||
      !event_id ||
      !item_group ||
      !category_name
    ) {
      return response.status(400).json({
        ok: false,
        msg: "Missing required fields",
      });
    }

    // Find the starting index
    const findIndexQuery = `
      SELECT item_id, serial_number
      FROM item_inv
      WHERE item_group = ? AND category_name = ?
      ORDER BY serial_number
    `;

    const findIndexValues = [item_group, category_name];

    connection.execute(findIndexQuery, findIndexValues, (err, results) => {
      if (err) {
        return response.status(500).json({
          ok: false,
          msg: `Database error: ${err.message}`,
        });
      }

      // Find the index of the starting number
      const startIndex = results.findIndex(
        (item) => item.serial_number === startingNumber
      );
      if (startIndex === -1) {
        return response.status(404).json({
          ok: false,
          msg: "Starting number not found",
        });
      }

      // Get the items to be inserted
      const itemsToInsert = results.slice(startIndex, startIndex + parseInt(quantity));

      if (itemsToInsert.length < quantity) {
        return response.status(400).json({
          ok: false,
          msg: "Not enough items available starting from the given number",
        });
      }

      const insertQuery = `
        INSERT INTO item_inv_assigned_event (item_id, event_id)
        VALUES ?
      `;

      const insertValues = itemsToInsert.map((item) => [
        item.item_id,
        event_id,
      ]);
      connection.query(insertQuery, [insertValues], (err, result) => {
        if (err) {
          return response.status(500).json({
            ok: false,
            msg: `Database error: ${err.message}`,
          });
        }

        response.status(201).json({
          ok: true,
          msg: "Items inserted successfully into event",
          inserted_items: result.affectedRows,
        });
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `Server error: ${error.message}`,
    });
  }
};

const insertingDeviceInEventDirectly = async (request, response) => {
  try {
    const { item_id, event_id } = request.body;
    const insertQuery = `
    INSERT INTO item_inv_assigned_event (item_id, event_id)
    values(?,?)
  `;
    const values = [item_id, event_id];
    connection.query(insertQuery, values, (err, result) => {
      if (err) {
        return response.status(500).json({
          ok: false,
          msg: `Database error: ${err.message}`,
        });
      }

      response.status(201).json({
        ok: true,
        msg: "Items inserted successfully into event",
        inserted_items: result.affectedRows,
      });
    });
  } catch (error) {
    console.log(error);
    response.status(201).json({
      ok: false,
      msg: `error: ${error}`,
    });
  }
};
const deletingItemsInEventAfterDeviceInventoryIsUpdated = (
  request,
  response
) => {
  try {
    const { event_id, item_group, category_name, serial_number } = request.body;

    const query = `
      DELETE FROM item_inv_assigned_event
      WHERE event_id = ?
        AND item_id IN (
          SELECT item_id
          FROM item_inv
          WHERE item_group = ?
            AND category_name = ?
            AND serial_number = ?
        )
    `;

    // Create an array of values for the prepared statement
    const values = [event_id, item_group, category_name, serial_number];

    connection.execute(query, values, function (err, result) {
      if (err) {
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      }

      return response.status(200).json({
        ok: true,
        msg: "Items deleted successfully from event",
        deleted_items: result.affectedRows,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const consultingInventoryCurrentState = (request, response) => {
  try {
    const formatting = Object.keys(request.body).map((item) => item + "=?");
    const keys = formatting.toString().replaceAll(",", " AND ");
    const query = `
            SELECT ii.item_id,ii.serial_number,ii.warehouse, ii.category_name, ii.item_group, ii.cost, ii.ownership, iiae.status, iiae.condition, ei.event_name
            FROM item_inv ii
            LEFT JOIN (
                SELECT item_id, MAX(created_at) AS max_created_at
                FROM item_inv_assigned_event
                GROUP BY item_id
            ) max_iiae ON ii.item_id = max_iiae.item_id
            LEFT JOIN item_inv_assigned_event iiae ON ii.item_id = iiae.item_id AND max_iiae.max_created_at = iiae.created_at
            LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
            WHERE ii.${keys};`;
    const values = [...Object.values(request.body).map((item) => item)];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });

      return response.status(201).json({
        ok: true,
        result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const consultingInventoryInEvent = (request, response) => {
  try {
    const event_id = request.params.id;
    const query = `
                SELECT
                ii.item_id , ii.category_name, ii.item_group ,ii.serial_number ,ii.warehouse, ii.brand, ii.main_warehouse, ii.cost , iiae.status , iiae.condition ,iiae.updated_at 
                FROM
                    item_inv ii
                LEFT JOIN (
                    SELECT
                        item_id,
                        MAX(created_at) AS max_created_at
                    FROM
                        item_inv_assigned_event
                    GROUP BY
                        item_id
                            ) max_iiae ON
                    ii.item_id = max_iiae.item_id
                LEFT JOIN item_inv_assigned_event iiae ON
                    ii.item_id = iiae.item_id
                    AND max_iiae.max_created_at = iiae.created_at
                LEFT JOIN event_info ei ON
                    ei.event_id = iiae.event_id
                WHERE
                    ei.event_id = ?
                    ORDER BY ii.serial_number ASC`;
    const values = [event_id];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });

      return response.status(201).json({
        ok: true,
        result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const consultingRowInItemInvAssignedEventTable = (request, response) => {
  try {
    const { item_id, company_assigned_event_id } = request.body;
    const query = `SELECT ei.*
FROM event_info ei
JOIN item_inv_assigned_event iae ON ei.event_id = iae.event_id 
WHERE iae.item_id = ? 
  AND ei.company_assigned_event_id = ?;`;
    const values = [item_id, company_assigned_event_id];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });

      return response.status(201).json({
        ok: true,
        result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const deletingRecordInItemInvAssignedEventRow = (request, response) => {
  try {
    const { event_id, item_id } = request.body;

    const query = `DELETE FROM item_inv_assigned_event WHERE event_id = ? AND item_id = ?;`;

    // Create an array of values for the prepared statement
    const values = [event_id, item_id];

    connection.execute(query, values, function (err, result) {
      if (err) {
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      }

      return response.status(200).json({
        ok: true,
        msg: "Items deleted successfully from event",
        deleted_items: result.affectedRows,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
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
};
