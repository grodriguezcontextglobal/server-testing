const { response, request } = require("express");
const getConnection = require("../database/config");
const { createClient } = require("redis");
const { clientRedis } = require("../../database/cacheMemoryConfig");
require("dotenv").config();

const insertingItem = (request, response) => {
  try {
    const connection = getConnection();
    const {
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      main_warehouse,
      serial_number,
      warehouse,
      company,
      location,
      current_location,
      extra_serial_number,
    } = request.body;
    const query = `
                        insert into item_inv
                        (
                        category_name, 
                        item_group, 
                        cost, 
                        brand,
                        descript_item, 
                        ownership, 
                        main_warehouse,
                        serial_number, 
                        warehouse, 
                        company, 
                        location,
                        current_location,
                        extra_serial_number
                        )
                        values(?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const values = [
      `${category_name}`,
      `${item_group}`,
      `${cost}`,
      `${brand}`,
      `${descript_item}`,
      `${ownership}`,
      `${main_warehouse}`,
      `${serial_number}`,
      warehouse,
      `${company}`,
      `${location}`,
      `${current_location}`,
      `${extra_serial_number}`,
    ];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });

      return response.status(201).json({
        ok: true,
        item: result,
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

const consultingItem = async (request, response) => {
  try {
    const connection = getConnection();
    const formatting = Object.keys(request.body).map((item) => item + "=?");
    const keys = formatting.toString().replaceAll(",", " AND ");
    const values = [...Object.values(request.body).map((item) => item)];
    const query = `select * from item_inv where ${keys};`;
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response.status(201).json({
        ok: true,
        items: result,
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

const deleteItem = async (request, response) => {
  try {
    const connection = getConnection();
    const query = "delete from item_inv where item_id=?";
    const values = [request.body.item_id];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response?.status(201)?.json({
        ok: true,
        item_deleted: result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
  }
};

const consultingItemTable = async (request, response) => {
  try {
    const connection = getConnection();
    const query = "select * from item_inv where company=?;";
    const values = [`${request.body.company}`];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response.status(201).json({
        ok: true,
        items: result,
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

const consultingItemInWarehouseTable = (request, response) => {
  try {
    const connection = getConnection();
    const formatting = Object.keys(request.body).map((item) => item + "=?");
    const keys = formatting.toString().replaceAll(",", " AND ");
    const values = [...Object.values(request.body).map((item) => item)];
    const query = `select * from item_inv where ${keys}`;
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response.status(201).json({
        ok: true,
        items: result,
      });
    });
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });

      return response?.status(201)?.json({
        ok: true,
        items: result,
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

const updateItemInTable = async (request, response) => {
  try {
    const connection = getConnection();
    const {
      item_id,
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      serial_number,
      warehouse,
      status,
      main_warehouse,
      updated_at,
      company,
      location,
      current_location,
    } = request.body;
    const query = `UPDATE item_inv 
                        SET category_name=?,
                            item_group=?,  
                            cost=?,  
                            brand=?,
                            descript_item=?,
                            ownership=?,
                            serial_number=?,
                            warehouse=?,
                            status=?,
                            main_warehouse=?,
                            update_at=?,
                            company=?,
                            location=?,
                            current_location=?
                        WHERE item_id=?;`;
    const values = [
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      serial_number,
      warehouse,
      status,
      main_warehouse,
      updated_at,
      company,
      location,
      current_location,
      item_id,
    ]; // Updated values array
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(401).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response.status(201).json({
        ok: true,
        items: result,
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

const updateItemInWarehouseAfterBeingAddedToEvent = async (
  request,
  response
) => {
  try {
    const connection = getConnection();
    const { warehouse, item_group, startingNumber, quantity, company } =
      request.body;

    // Validate request body
    if (!item_group || !startingNumber || !quantity || !company) {
      return response.status(400).json({
        ok: false,
        msg: "Missing required fields",
      });
    }

    // Find the starting index
    const findIndexQuery = `
        SELECT item_id, serial_number
        FROM item_inv
        WHERE item_group = ? AND company = ?
        ORDER BY serial_number
      `;
    const findIndexValues = [item_group, company];

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

      // Get the items to be updated
      const itemsToUpdate = results.slice(
        startIndex,
        startIndex + Number(quantity)
      );

      if (itemsToUpdate.length < Number(quantity)) {
        return response.status(400).json({
          ok: false,
          msg: "Not enough items available starting from the given number",
        });
      }

      const updateQuery = `
          UPDATE item_inv 
          SET warehouse = ?, update_at = NOW()
          WHERE item_id IN (?)
        `;

      const itemIds = itemsToUpdate.map((item) => item.item_id);
      const updateValues = [warehouse, itemIds];

      connection.query(updateQuery, updateValues, (err, result) => {
        if (err) {
          return response.status(500).json({
            ok: false,
            msg: `Database error: ${err.message}`,
          });
        }

        response.status(201).json({
          ok: true,
          msg: "Items updated successfully in the warehouse",
          updated_items: result.affectedRows,
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

// const updateItemInWarehouseAfterBeingAddedToEvent = async (request, response) => {
//     try {
//         const connection = getConnection()
//         const { warehouse, item_group, min_serial_number, max_serial_number, company } = request.body;

//         const query = `
//             UPDATE item_inv
//             SET warehouse = ?, update_at = NOW()
//             WHERE item_group = ? AND serial_number BETWEEN ? AND ? And company = ?`;

//         const values = [warehouse, item_group, min_serial_number, max_serial_number, company];

//         connection.execute(query, values, function (err, result, fields) {
//             if (err) return response.status(401).json({
//                 ok: false,
//                 msg: `${err.message}`,
//             });
//             return response.status(201).json({
//                 ok: true,
//                 msg: 'Items updated successfully in the warehouse',
//                 updated_items: result
//             });
//         });
//     } catch (error) {
//         console.error('Error:', error.message);
//         response.status(500).json({
//             ok: false,
//             msg: `${error.message}`,
//         });
//     }
// };

const returningItemToStockWhenEventIsFinished = async (request, response) => {
  try {
    const connection = getConnection();
    const {
      warehouse,
      status,
      update_at,
      serial_number,
      category_name,
      item_group,
      company,
    } = request.body;
    const query = ` UPDATE
        item_inv
    SET
        warehouse =?,
        status =?,
        update_at =?
    WHERE
        serial_number =?
        and category_name = ?
        and item_group = ?
        and company = ?;`;
    const values = [
      warehouse,
      status,
      update_at,
      serial_number,
      category_name,
      item_group,
      company,
    ];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(401).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response?.status(201)?.json({
        ok: true,
        items: result,
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

const itemFinalStatusWhenEventIsFinished = async (request, response) => {
  try {
    const connection = getConnection();
    const { status, condition, updated_at, serial_number, event_id } =
      request.body;
    const query = `
                UPDATE item_inv_assigned_event iiae
                JOIN item_inv ii ON iiae.item_id = ii.item_id
                SET iiae.status = ?, iiae.condition = ?, iiae.updated_at = ?
                WHERE ii.serial_number = ?
                AND iiae.event_id = ?;
                    `;
    const values = [status, condition, updated_at, serial_number, event_id];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(401).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response?.status(201)?.json({
        ok: true,
        items: result,
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

const consultingInventoryTracking = (request, response) => {
  try {
    const connection = getConnection();
    const item_id = request.params.id;
    const query = `
        SELECT ii.* , iiae.status, iiae.condition, ei.event_name
        FROM item_inv ii
        LEFT JOIN item_inv_assigned_event iiae ON iiae.item_id = ii.item_id
        LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
        WHERE ii.item_id = ?
        ORDER by ii.update_at ASC
        `;
    const values = [item_id];
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

module.exports = {
  consultingItem,
  insertingItem,
  consultingItemTable,
  consultingItemInWarehouseTable,
  deleteItem,
  updateItemInTable,
  updateItemInWarehouseAfterBeingAddedToEvent,
  consultingInventoryTracking,
  returningItemToStockWhenEventIsFinished,
  itemFinalStatusWhenEventIsFinished,
};
