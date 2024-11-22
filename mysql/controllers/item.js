const { response, request } = require("express");
const getConnection = require("../database/config");
const { clientRedis } = require("../../database/cacheMemoryConfig");
require("dotenv").config();

const insertingItem = async (request, response) => {
  try {
    const connection = getConnection();
    const cache_connection = await clientRedis();
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
      company_id,
      return_date,
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
                        extra_serial_number,
                        company_id,
                        return_date,
                        enableAssignFeature
                        )
                        values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
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
      company_id,
      `${return_date && return_date}`,
      true,
    ];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      cache_connection.del(
        `company_id=${company_id}&warehouse=true&enableAssignFeature=1`
      );
      cache_connection.del(
        `company_id=${company_id}&warehouse=false&enableAssignFeature=1`
      );
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

const insertBulkItem = async (request, response) => {
  try {
    const connection = getConnection();
    const cache_connection = await clientRedis();
    const {
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      main_warehouse,
      warehouse,
      company,
      location,
      current_location,
      extra_serial_number,
      company_id,
      return_date,
      min_serial_number,
      max_serial_number,
      enableAssignFeature,
    } = request.body;

    if (!min_serial_number || !max_serial_number) {
      return response.status(400).json({
        ok: false,
        msg: "Minimum and maximum serial numbers are required.",
      });
    }

    // Generate serial numbers from min_serial_number to max_serial_number
    const serialNumbers = [];
    let currentSerial = parseInt(min_serial_number, 10);
    const maxSerial = parseInt(max_serial_number, 10);

    while (currentSerial <= maxSerial) {
      serialNumbers.push(
        currentSerial.toString().padStart(min_serial_number.length, "0")
      );
      currentSerial++;
    }

    if (serialNumbers.length === 0) {
      return response.status(400).json({
        ok: false,
        msg: "No serial numbers generated.",
      });
    }

    const query = `
      INSERT INTO item_inv
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
        extra_serial_number,
        company_id,
        return_date,
        enableAssignFeature
      )
      VALUES ?
    `;

    // Prepare an array of value arrays, each sub-array representing a row to be inserted
    const values = serialNumbers.map((serial_number) => [
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
      company_id,
      return_date || null,
      enableAssignFeature,
    ]);

    connection.query(query, [values], function (err, result) {
      if (err) {
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      }
      cache_connection.del(`company_id=${company_id}&warehouse=true&enableAssignFeature=1`);
      cache_connection.del(`company_id=${company_id}&warehouse=false&enableAssignFeature=1`);

      return response.status(201).json({
        ok: true,
        item: result,
      });
    });
  } catch (error) {
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
    const cache_connection = await clientRedis();
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
      return_date,
    } = request.body;

    const query = `
    UPDATE item_inv 
    SET category_name = ?, 
    item_group = ?,  
    cost = ?,  
    brand = ?, 
    descript_item = ?, 
    ownership = ?, 
      serial_number = ?, 
      warehouse = ?, 
      status = ?, 
      main_warehouse = ?, 
      update_at = ?, 
      company = ?, 
      location = ?, 
      current_location = ?, 
      return_date = ? 
      WHERE item_id = ?`;

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
      return_date, // this should be formatted correctly as a string
      item_id, // item_id should be the last parameter in the query
    ];
    // cache_connection.del(`company_id=${company_id}&warehouse=true&enableAssignFeature=1`);
    // cache_connection.del(`company_id=${company_id}&warehouse=false&enableAssignFeature=1`);

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
          ok: true,
          message: "No changes were made to the item.",
          items: result,
        });
      }

      return response.status(201).json({
        ok: true,
        message: "Item updated successfully.",
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
    const cache_connection = await clientRedis();
    const connection = getConnection();
    const { warehouse, item_group, startingNumber, quantity, company_id } =
      request.body;
    cache_connection.del(
      `company_id=${company_id}&warehouse=true&enableAssignFeature=1`
    );

    // Validate request body
    if (!item_group || !startingNumber || !quantity || !company_id) {
      return response.status(400).json({
        ok: false,
        msg: "Missing required fields",
      });
    }

    // Find the starting index
    const findIndexQuery = `
    SELECT item_id, serial_number
    FROM item_inv
    WHERE item_group = ? AND company_id = ?
    ORDER BY serial_number
    `;
    const findIndexValues = [item_group, company_id];

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

const returningItemToStockWhenEventIsFinished = async (request, response) => {
  try {
    const connection = getConnection();
    const cache_connection = await clientRedis();
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
        update_at =?
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
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(401).json({
          ok: false,
          msg: `${err.message}`,
        });
      cache_connection.del(
        `company_id=${company_id}&warehouse=true&enableAssignFeature=1`
      );
      cache_connection.del(
        `company_id=${company_id}&warehouse=false&enableAssignFeature=1`
      );

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
    SET iiae.status = ?, iiae.condition = ?, iiae.updated_at = ?, active = false
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
    SELECT ii.* , iiae.status, iiae.condition, ei.*
    FROM item_inv ii
    LEFT JOIN item_inv_assigned_event iiae ON iiae.item_id = ii.item_id
    LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
    WHERE ii.item_id = ?
    ORDER by iiae.event_id DESC
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

const checkingInventoryCurrentState = async (request, response) => {
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

const checkingItem = async (request, response) => {
  try {
    //company_id=122&warehouse=true&enableAssignFeature=1
    const cache_connection = await clientRedis();
    const params = request._parsedUrl.query;
    const checkingInMemory = await cache_connection.get(`${params}`);
    if (checkingInMemory) {
      return response.status(201).json({
        ok: true,
        items: JSON.parse(checkingInMemory),
      });
    } else {
      const splitting = params.split("&");
      const formatting = splitting.map((item) => item.split("=")[0] + "=?");
      const keys = formatting.toString().replaceAll(",", " AND ");
      const values = [...splitting.map((item) => item.split("=")[1])];
      const query = `select * from item_inv where ${keys};`;
      const connection = getConnection();
      connection.execute(query, values, function (err, result, fields) {
        if (err)
          return response.status(500).json({
            ok: false,
            msg: `${err.message}`,
          });
        cache_connection.set(`${params}`, JSON.stringify(result));
        cache_connection.expire(`${params}`, 60);

        return response.status(201).json({
          ok: true,
          items: result,
        });
      });
    }
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const searchingInventoryTracking = (request, response) => {
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
    ];
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
    response.status(500).json({
      ok: false,
      msg: `Error: ${error.message}`,
      error,
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
    response.status(500).json({
      ok: false,
      msg: `Error: ${error.message}`,
      error,
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
  returningLeasedEquipmentToCompany,
  insertBulkItem,
  searchingInventoryTracking,
  checkingItem,
  checkingInventoryCurrentState,
  searchingGetInventoryTracking,
};
