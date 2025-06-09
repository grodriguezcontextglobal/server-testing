const { response, request } = require("express");
const getConnection = require("../database/config");
// const { clientRedis } = require("../../database/cacheMemoryConfig");
const { groupBy } = require("lodash");
require("dotenv").config();
const connection = getConnection();

const insertingItem = async (request, response) => {
  const connection = getConnection();
  // const cache_connection = await clientRedis();
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
    sub_location,
    current_location,
    extra_serial_number,
    company_id,
    return_date,
    container,
    containerSpotLimit,
    image_url,
  } = request.body;

  const query = `
    INSERT INTO item_inv (
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
      sub_location,
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
      display_item
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
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
    sub_location,
    current_location,
    extra_serial_number,
    company_id,
    return_date || null,
    container ? container : false,
    containerSpotLimit ? containerSpotLimit : 0,
    1,
    image_url || null,
    (returnedRentedInfo = JSON.stringify([])),
    (container_id = JSON.stringify([])),
    (display_item = 1),
  ];
  try {
    const [result] = await connection.execute(query, values);

    // await cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=true&enableAssignFeature=1`);
    // await cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=false&enableAssignFeature=1`);

    return response.status(201).json({
      ok: true,
      item: result,
    });
  } catch (error) {
    console.error("Error:", error);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const insertBulkItem = async (request, response) => {
  try {
    const connection = getConnection();
    // const cache_connection = await clientRedis();
    const {
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      min_serial_number,
      max_serial_number,
      warehouse,
      main_warehouse,
      created_at,
      update_at,
      company,
      location,
      current_location,
      sub_location,
      extra_serial_number,
      company_id,
      return_date,
      returnedRentedInfo,
      container,
      containerSpotLimit,
      containerId,
      display_item,
      enableAssignFeature,
      image_url,
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
      serial_number,
      warehouse,
      main_warehouse,
      create_at,
      update_at,
      company,
      location,
      current_location,
      sub_location,
      extra_serial_number,
      company_id,
      return_date,
      returnedRentedInfo,
      container,
      containerSpotLimit,
      container_id,
      display_item,
      enableAssignFeature,
      image_url
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
      serial_number,
      warehouse,
      main_warehouse,
      created_at,
      update_at,
      company,
      location,
      current_location,
      sub_location,
      extra_serial_number,
      company_id,
      return_date,
      returnedRentedInfo,
      container,
      containerSpotLimit,
      containerId,
      display_item,
      enableAssignFeature,
      image_url || null, // Handle undefined image_url
    ]);

    const [result] = await connection.query(query, [values]);
    // connection.query(query, [values], function (err, result) {
    // });
    // cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=true&enableAssignFeature=1`);
    // cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=false&enableAssignFeature=1`);

    return response.status(201).json({
      ok: true,
      item: result,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
      err: error,
    });
  }
};

const insertBulkItemAlhpanumericFormat = async (request, response) => {
  try {
    const {
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      list,
      warehouse,
      main_warehouse,
      created_at,
      update_at,
      company,
      location,
      current_location,
      sub_location,
      extra_serial_number,
      company_id,
      return_date,
      returnedRentedInfo,
      container,
      containerSpotLimit,
      containerId,
      display_item,
      enableAssignFeature,
      image_url,
    } = request.body;

    const connection = getConnection();
    const query = `
    INSERT INTO item_inv (
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      serial_number,
      warehouse,
      main_warehouse,
      create_at,
      update_at,
      company,
      location,
      current_location,
      sub_location,
      extra_serial_number,
      company_id,
      return_date,
      returnedRentedInfo,
      container,
      containerSpotLimit,
      container_id,
      display_item,
      enableAssignFeature,
      image_url
    ) VALUES ?`;

    // Prepare an array of value arrays, each sub-array representing a row to be inserted
    const values = list.map((serial_number) => [
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      serial_number,
      warehouse,
      main_warehouse,
      created_at,
      update_at,
      company,
      location,
      current_location,
      sub_location,
      extra_serial_number,
      company_id,
      return_date,
      returnedRentedInfo,
      container,
      containerSpotLimit,
      containerId,
      display_item,
      enableAssignFeature,
      image_url || null, // Handle undefined image_url
    ]);

    const [result] = await connection.query(query, [values]);
    return response.status(201).json({
      ok: true,
      item: result,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
      err: error,
    });
  }
};

const consultingItem = async (request, response) => {
  try {
    const connection = getConnection();
    const formatting = Object.keys(request.body)
      .map((item) => `${item}=?`)
      .join(" AND ");
    const values = Object.values(request.body);
    const query = `SELECT * FROM item_inv WHERE ${formatting};`;
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      items: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const deleteItem = async (request, response) => {
  try {
    const connection = getConnection();
    const query = "DELETE FROM item_inv WHERE item_id=?";
    const values = [request.body.item_id];
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      item_deleted: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
      ok: true,
      items: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const consultingItemInWarehouseTable = async (request, response) => {
  try {
    const connection = getConnection();
    const formatting = Object.keys(request.body)
      .map((item) => `${item}=?`)
      .join(" AND ");
    const values = Object.values(request.body);
    const query = `SELECT * FROM item_inv WHERE ${formatting};`;
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      items: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
      update_at,
      company,
      location,
      sub_location,
      current_location,
      return_date,
      extra_serial_number,
      container,
      containerSpotLimit,
      image_url,
    } = request.body;
    const query = `
      UPDATE item_inv 
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
      sub_location=?,
      current_location=?,
      return_date=?,
      extra_serial_number=?,
      container=?,
      containerSpotLimit=?,
      image_url=?
      WHERE item_id = ?;
    `;

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
      update_at,
      company,
      location,
      sub_location,
      current_location,
      return_date,
      extra_serial_number,
      container,
      containerSpotLimit,
      image_url,
      item_id,
    ];

    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      items: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
    // const cache_connection = await clientRedis();
    const connection = getConnection();
    const { warehouse, item_group, startingNumber, quantity, company_id } =
      request.body;
    // cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=true&enableAssignFeature=1`);

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
    const [result] = await connection.execute(query, values);
    // cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=true&enableAssignFeature=1`);
    // cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=false&enableAssignFeature=1`);

    return response?.status(201)?.json({
      ok: true,
      items: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const returningItemToStockWhenEventIsFinishedRefactored = async (
  request,
  response
) => {
  try {
    let resultAffectedRows = [];
    const connection = getConnection();
    // const cache_connection = await clientRedis();
    const {
      groupingDevicesFromNoSQL,
      allInventoryOfEvent,
      companyId,
      update_at,
    } = request.body;
    const company_id = companyId;
    const groupingDevicesFromNoSQLParsed = JSON.parse(groupingDevicesFromNoSQL);
    const allInventoryOfEventParsed = JSON.parse(allInventoryOfEvent);
    const query = ` UPDATE
                    item_inv
                    SET
                    warehouse = true,
                    status =?,
                    update_at =?
                    WHERE
                    serial_number =?
                    and category_name = ?
                    and item_group = ?
                    and company_id = ?;`;
    for (let data of allInventoryOfEventParsed) {
      if (groupingDevicesFromNoSQLParsed[data.serial_number]) {
        const values = [
          groupingDevicesFromNoSQLParsed[data.serial_number].at(-1).status,
          update_at,
          data.serial_number,
          data.category_name,
          data.item_group,
          company_id,
        ];
        const [result] = await connection.execute(query, values);
        resultAffectedRows = [...resultAffectedRows, result.affectedRows];
      } else {
        const values = [
          data.status,
          update_at,
          data.serial_number,
          data.category_name,
          data.item_group,
          company_id,
        ];
        const [result] = await connection.execute(query, values);
        resultAffectedRows = [...resultAffectedRows, result.affectedRows];
      }
    }
    // cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=true&enableAssignFeature=1`);
    // cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=false&enableAssignFeature=1`);
    return response.status(201)?.json({
      ok: true,
      // items: result,
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
    const [result] = await connection.execute(query, values);
    return response?.status(201)?.json({
      ok: true,
      items: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const itemFinalStatusWhenEventIsFinishedRefactored = async (
  request,
  response
) => {
  try {
    const connection = getConnection();
    let finalResult = [];
    const {
      groupingDevicesFromNoSQL,
      allInventoryOfEvent,
      eventId,
      update_at,
    } = request.body;
    const groupingDevicesFromNoSQLParsed = JSON.parse(groupingDevicesFromNoSQL);
    const allInventoryOfEventParsed = JSON.parse(allInventoryOfEvent);
    const event_id = eventId;
    const updated_at = update_at;
    const query = `
    UPDATE item_inv_assigned_event iiae
    JOIN item_inv ii ON iiae.item_id = ii.item_id
    SET iiae.status = ?, iiae.condition = ?, iiae.updated_at = ?, active = false
                WHERE ii.serial_number = ?
                AND iiae.event_id = ?;
                    `;
    for (let data of allInventoryOfEventParsed) {
      if (groupingDevicesFromNoSQLParsed[data.serial_number]) {
        const values = [
          groupingDevicesFromNoSQLParsed[data.serial_number].at(-1).status,
          groupingDevicesFromNoSQLParsed[data.serial_number].at(-1).status,
          updated_at,
          data.serial_number,
          event_id,
        ];
        const [result] = await connection.execute(query, values);
        finalResult = [...finalResult, result];
      } else {
        const values = [
          data.status,
          data.condition,
          updated_at,
          data.serial_number,
          event_id,
        ];
        const [result] = await connection.execute(query, values);
        finalResult = [...finalResult, result];
      }
    }
    return response.status(201)?.json({
      ok: true,
      // items: finalResult,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
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
    // const item_id = request.params.id;
    const company_id = request.params.company_id;
    const query = `
    SELECT ii.* , iiae.status, iiae.condition, ei.*
    FROM item_inv ii
    LEFT JOIN item_inv_assigned_event iiae ON iiae.item_id = ii.item_id
    LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
        WHERE ii.company_id = ${company_id}
        ORDER by iiae.event_id DESC
        `;
    // const values = [company_id];
    const [result] = await connection.execute(query); //, values
    return response.status(201).json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error("Error:", error);
    response.status(500).json({
      ok: false,
      msg: `${error}`,
    });
  }
};

const checkingItem = async (request, response) => {
  try {
    //company_id=122&warehouse=true&enableAssignFeature=1
    // const cache_connection = await clientRedis();
    const params = request._parsedUrl.query;
    // const checkingInMemory = await cache_connection.get(`${params}`);
    // if (checkingInMemory) {
    //   return response.status(201).json({
    //     cached: true,
    //     ok: true,
    //     items: JSON.parse(checkingInMemory),
    //   });
    // } else {
    const splitting = params.split("&");
    const formatting = splitting.map((item) => item.split("=")[0] + "=?");
    const keys = formatting.toString().replaceAll(",", " AND ");
    const values = [...splitting.map((item) => item.split("=")[1])];
    const query = `select * from item_inv where ${keys};`;
    const connection = getConnection();
    const [result] = await connection.execute(query, values);
    // cache_connection.set(`${params}`, JSON.stringify(result));
    // cache_connection.expire(`${params}`, 60);
    return response.status(201).json({
      cached: false,
      ok: true,
      items: result,
    });
    // }
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
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
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      result,
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
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      result,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: `Error: ${error.message}`,
      error,
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
      ok: true,
      items: result,
    });
  } catch (error) {
    const responseTemplate = {
      ok: false,
      msg: `Error: ${error.message}`,
      error,
      codeStatus: 500,
    };
    response.send(JSON.stringify(responseTemplate));
  }
};

const gettingDataFromLocationOption = async (request, response) => {
  try {
    const connection = getConnection();
    const params = request._parsedUrl.query;
    const company_id = new URLSearchParams(params).get("company_id");
    const query = `
      SELECT location, COUNT(location) as total_count, 
             SUM(CASE WHEN warehouse = false and enableAssignFeature = true THEN 1 ELSE 0 END) as warehouse_true_count
      FROM item_inv 
      WHERE company_id = ?
      GROUP BY location
      ORDER BY location ASC
    `;

    const values = [company_id];

    // Execute the query
    const [result] = await connection.execute(query, values);
    return response.status(201).json({
      ok: true,
      items: result,
      cached: false,
    });
  } catch (error) {
    const responseTemplate = {
      ok: false,
      msg: `Error: ${error.message}`,
      error,
      codeStatus: 500,
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
      statusCode: 200,
      cached: false,
      ok: true,
      items: JSON.stringify(result),
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const containerItemsDetails = async (props) => {
  try {
    const connection = getConnection();
    //removing items from container
    const removingItems =
      typeof props.remove === "string"
        ? JSON.parse(props.remove)
        : props.remove;
    for (let item of removingItems) {
      const query = `
      UPDATE item_inv
      SET container_id = ?,
      isItInContainer = ?,
      display_item = ?
      WHERE item_id = ?;
      `;
      const values = [null, 0, 1, item.item_id];
      await connection.execute(query, values);
    }
    //adding new items to container
    const data =
      typeof props.data === "string" ? JSON.parse(props.data) : props.data;
    for (let item of data) {
      const query = `
      UPDATE item_inv
      SET container_id = ?,
      isItInContainer = ?,
      display_item = ?
      WHERE item_id = ?;
    `;
      const values = [props.container_id, 1, 0, item.item_id];
      await connection.execute(query, values);
    }
  } catch (error) {
    console.error("Error:", error);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
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
      data: container_items,
      container_id: item_id,
      remove: ref,
    });
    return response.status(201).json({
      ok: true,
      items: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateItemInTableAfterBeingAddedToEventFromContainer = async (
  request,
  response
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
      ok: true,
      msg: "Items updated successfully in the warehouse",
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const retrieveItemLocationQuantityForEvent = async (request, response) => {
  try {
    const connection = getConnection();
    const options = new Map();

    const formatting = Object.keys(request.body)
      .map((item) => `${item}=?`)
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
        qty: summary.qty,
        start: summary.min_serial,
        end: summary.max_serial,
        serialNumberList: [],
        hasFullData: false,
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
      ok: true,
      items: Object.fromEntries(options),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
        ok: false,
        msg: "Missing required parameters: location, quantity, company_id, item_group",
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
      ok: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getGroupedItemInventory = async (request, response) => {
  try {
    const connection = getConnection();

    const formatting = Object.keys(request.body)
      .map((item) => `${item} = ?`)
      .join(" AND ");
    const values = Object.values(request.body);

    const query = `
      SELECT 
        category_name,
        item_group, 
        location, 
        COUNT(*) AS quantity
      FROM item_inv
      WHERE ${formatting}
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
      ok: true,
      groupedInventory: result,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
      (key) => body[key] !== undefined
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
      v === undefined ? null : v
    );

    const [result] = await connection.execute(query, queryValues);

    return response.status(200).json({
      ok: true,
      items: result,
      nextCursor: result.length > 0 ? result[result.length - 1].item_id : null,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
  response
) => {
  try {
    const connection = getConnection();

    // Step 1: extract company filters
    const formattingKeys = Object.keys(request.body);
    const formatting = formattingKeys.map((item) => `${item}=?`).join(" AND ");
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
      const { clause, values } = buildSublocationQuery(sublocationSegments);
      query += ` AND ${clause}`;
      queryValues.push(...values);
    }
    query += ` ORDER BY item_id ASC`;

    const [result] = await connection.execute(query, queryValues);
    return response.status(201).json({
      ok: true,
      count: result.length,
      items: result,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getGroupedItemWithFormatInventory = async (request, response) => {
  try {
    const connection = getConnection();

    const formatting = Object.keys(request.body)
      .map((item) => `${item} = ?`)
      .join(" AND ");
    const values = Object.values(request.body);

    const query = `
      SELECT 
        category_name,
        item_group,
        MIN(brand) AS brand,
        MIN(descript_item) AS descript_item,
        COUNT(*) AS quantity
      FROM item_inv
      WHERE ${formatting}
      GROUP BY 
        category_name,
        item_group
      ORDER BY 
        category_name ASC,
        item_group ASC
    `;

    const [rows] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      groupedInventory: rows,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const consultingCompanyInventoryBasedOnSubmittedParameters = async (
  request,
  response
) => {
  try {
    const connection = getConnection();
    let { query, values } = request.body;
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
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const retrieveItemData = async (request, response) => {
  try {
    const connection = getConnection();
    const { company_id } = request.body;

    const query = `
      SELECT 
        item_id, category_name, item_group, serial_number, ownership, descript_item, 
        warehouse, company, cost, create_at, update_at, status, location, 
        main_warehouse, current_location, brand, extra_serial_number, company_id, 
        return_date, returnedRentedInfo, enableAssignFeature, container, 
        container_items, isItInContainer, containerSpotLimit, container_id, 
        display_item, sub_location, image_url
      FROM item_inv
      WHERE company_id = ?
    `;

    const [items] = await connection.execute(query, [company_id]);

    const totalAvailable = items.filter((item) => item.warehouse === 1).length;
    const total = items.length;

    const groupedData = {
      category_name: groupBy(items, "category_name"),
      item_group: groupBy(items, "item_group"),
      brand: groupBy(items, "brand"),
      ownership: groupBy(items, "ownership"),
    };

    // Format the total available and total for each group
    const formatGroupData = (group) => {
      return Object.entries(group).reduce((acc, [key, value]) => {
        acc[key] = {
          totalAvailable: value.filter((item) => item.warehouse === 1).length,
          total: value.length,
        };
        return acc;
      }, {});
    };

    const formattedGroupedData = {
      category_name: formatGroupData(groupedData.category_name),
      item_group: formatGroupData(groupedData.item_group),
      brand: formatGroupData(groupedData.brand),
      ownership: formatGroupData(groupedData.ownership),
    };

    return response.status(200).json({
      ok: true,
      totalAvailable,
      total,
      groupedData: formattedGroupedData,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
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
          category_name: item.category_name,
          item_group: item.item_group,
          warehouse: item.warehouse,
          status: item.status,
          enableAssignFeature: item.enableAssignFeature,
          brand: item.brand,
          ownership: item.ownership,
          location: item.location,
          main_warehouse: item.main_warehouse,
          image_url: item.image_url,
          serial_number: item.serial_number,
          item: item.item_id,
          usage: usageMap.has(item.item_id)
            ? usageMap.get(item.item_id)[0]
            : [],
        };
      }

      return {
        category_name: item.category_name,
        item_group: item.item_group,
        warehouse: item.warehouse,
        status: item.status,
        enableAssignFeature: item.enableAssignFeature,
        brand: item.brand,
        ownership: item.ownership,
        location: item.location,
        main_warehouse: item.main_warehouse,
        image_url: item.image_url,
        serial_number: item.serial_number,
        item: item.item_id,
        usage: [],
      };
    });

    return response.status(200).json({
      ok: true,
      items: itemsWithUsage,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
      original_template,
    } = request.body;
    const query = `
      select item_id from item_inv
      where company_id = ? and
      category_name = ? and
      item_group = ?;
    `;
    const values = [
      company_id,
      original_template.category_name,
      original_template.item_group,
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
      update_at: update_at,
      warehouse: warehouse,
    };

    const keys = Object.keys(queryToUpdateParams);
    const updateQuery = `
      UPDATE item_inv SET ${keys.map((key) => `${key} = ?`).join(", ")} 
      WHERE item_id IN (${itemIds.map(() => "?").join(", ")})
    `;
    const sanitizedParams = keys.map((k) =>
      queryToUpdateParams[k] !== undefined ? queryToUpdateParams[k] : null
    );
    const updateValues = [...sanitizedParams, ...itemIds];
    const [finalResult] = await connection.execute(updateQuery, updateValues);
    return response.status(200).json({
      ok: true,
      msg: "Items updated successfully in the warehouse",
      result: finalResult,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const updateItemsBasedOnSerialNumber = async (request, response) => {
  try {
    const {
      brand,
      category_name,
      company_id,
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
      max_serial_number,
      min_serial_number,
      ownership,
      return_date,
      returnedRentedInfo,
      sub_location,
      update_at,
      warehouse,
      originalTemplate,
    } = request.body;

    const findQuery = `
      select item_id from item_inv
      where company_id = ? and
      category_name = ? and
      item_group = ? and
      serial_number >= ? and
      serial_number <= ?
    `;

    const findValues = [
      company_id,
      originalTemplate.category_name,
      originalTemplate.item_group,
      min_serial_number,
      max_serial_number,
    ];

    const [result] = await connection.execute(findQuery, findValues);

    const itemIds = result.map((item) => item.item_id);
    const queryToUpdateParams = {
      category_name: category_name,
      item_group: item_group,
      cost: cost,
      brand: brand,
      descript_item: descript_item,
      ownership: ownership,
      warehouse: warehouse,
      main_warehouse: main_warehouse,
      update_at: update_at,
      location: location,
      current_location: current_location,
      sub_location: sub_location,
      extra_serial_number: extra_serial_number,
      return_date: return_date,
      returnedRentedInfo: returnedRentedInfo,
      container: container,
      containerSpotLimit: containerSpotLimit,
      display_item: display_item,
      enableAssignFeature: enableAssignFeature,
      image_url: image_url,
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
      ok: true,
      msg: "Items updated successfully in the warehouse",
      queryToUpdateParams,
      result: finalResult,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateItemsBasedOnAlphanumericSerialNumber = async (
  request,
  response
) => {
  try {
    const {
      brand,
      category_name,
      company_id,
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
      list,
      ownership,
      return_date,
      returnedRentedInfo,
      sub_location,
      update_at,
      warehouse,
      originalTemplate,
    } = request.body;

    const findQuery = `
      select item_id from item_inv
      where company_id = ? and
      category_name = ? and
      item_group = ? and
      serial_number in (${list.map(() => "?").join(", ")})    `;

    const findValues = [
      company_id,
      originalTemplate.category_name,
      originalTemplate.item_group,
      ...list,
    ];

    const [result] = await connection.execute(findQuery, findValues);

    const itemIds = result.map((item) => item.item_id);
    const queryToUpdateParams = {
      category_name: category_name,
      item_group: item_group,
      cost: cost,
      brand: brand,
      descript_item: descript_item,
      ownership: ownership,
      warehouse: warehouse,
      main_warehouse: main_warehouse,
      update_at: update_at,
      location: location,
      current_location: current_location,
      sub_location: sub_location,
      extra_serial_number: extra_serial_number,
      return_date: return_date,
      returnedRentedInfo: returnedRentedInfo,
      container: container,
      containerSpotLimit: containerSpotLimit,
      display_item: display_item,
      enableAssignFeature: enableAssignFeature,
      image_url: image_url,
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
      ok: true,
      msg: "Items updated successfully in the warehouse",
      queryToUpdateParams,
      result: finalResult,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

module.exports = {
  checkingIfCompanyHasInventory,
  checkingInventoryCurrentState,
  checkingItem,
  checkInventoryCompanyExists,
  consultingCompanyInventoryBasedOnLocationAndSubLocation,
  consultingCompanyInventoryBasedOnSubmittedParameters,
  consultingCompanyInventoryWithPagination,
  consultingInventoryTracking,
  consultingItem,
  consultingItemInWarehouseTable,
  consultingItemTable,
  consultItemDataFromSerialNumber,
  deleteItem,
  fragmentData,
  getGroupedItemInventory,
  getGroupedItemWithFormatInventory,
  gettingDataFromLocationOption,
  insertBulkItem,
  insertBulkItemAlhpanumericFormat,
  insertingItem,
  itemFinalStatusWhenEventIsFinished,
  itemFinalStatusWhenEventIsFinishedRefactored,
  retrieveCompanyInventory,
  retrieveItemData,
  retrieveItemLocationQuantityForEvent,
  returningItemToStockWhenEventIsFinished,
  returningItemToStockWhenEventIsFinishedRefactored,
  returningLeasedEquipmentToCompany,
  searchingGetInventoryTracking,
  searchingInventoryTracking,
  updateContentInContainerItem,
  updateItemInTable,
  updateItemInTableAfterBeingAddedToEventFromContainer,
  updateItemInWarehouseAfterBeingAddedToEvent,
  updateAllItemsInInventory,
  updateItemsBasedOnSerialNumber,
  updateItemsBasedOnAlphanumericSerialNumber,
};
