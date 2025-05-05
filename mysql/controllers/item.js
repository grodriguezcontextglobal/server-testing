const { response, request } = require("express");
const getConnection = require("../database/config");
const { clientRedis } = require("../../database/cacheMemoryConfig");
const { groupBy, orderBy } = require("lodash");
require("dotenv").config();

const insertingItem = async (request, response) => {
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
      image_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    image_url,
  ];

  try {
    const [result] = await connection.promise().execute(query, values);

    await cache_connection.del(
      `company_id=${company_id}&warehouse=true&enableAssignFeature=1`
    );
    await cache_connection.del(
      `company_id=${company_id}&warehouse=false&enableAssignFeature=1`
    );

    return response.status(201).json({
      ok: true,
      item: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
      sub_location,
      current_location,
      extra_serial_number,
      company_id,
      return_date,
      min_serial_number,
      max_serial_number,
      enableAssignFeature = 1,
      container,
      containerSpotLimit,
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
        enableAssignFeature,
        container,
        containerSpotLimit,
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
      enableAssignFeature,
      container,
      containerSpotLimit,
      image_url,
    ]);
    const [result] = await connection.promise().query(query, [values]);
    // connection.query(query, [values], function (err, result) {
    // });
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
    const formatting = Object.keys(request.body)
      .map((item) => `${item}=?`)
      .join(" AND ");
    const values = Object.values(request.body);
    const query = `SELECT * FROM item_inv WHERE ${formatting};`;
    const [result] = await connection.promise().execute(query, values);
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
    const [result] = await connection.promise().execute(query, values);
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
    const [result] = await connection.promise().execute(query, values);
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
    const [result] = await connection.promise().execute(query, values);
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

    const [result] = await connection.promise().execute(query, values);
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
    const [result] = await connection.promise().execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(401).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });
    //   });
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
    const cache_connection = await clientRedis();
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
        const [result] = await connection.promise().execute(query, values);
        //  , function (err, result, fields) {
        //     if (err) {
        //       return response.status(401).json({
        //         ok: false,
        //         msg: `${err.message}`,
        //       });
        //     }
        //   });
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
        const [result] = await connection.promise().execute(query, values);
        // if (err) {
        //     return response.status(401).json({
        //       ok: false,
        //       msg: `${err.message}`,
        //     });
        //   }
        //   console.log(
        //     "returningItemToStockWhenEventIsFinishedRefactored affected row",
        //     result.affectedRows
        //   );
        // });
        resultAffectedRows = [...resultAffectedRows, result.affectedRows];
      }
    }
    cache_connection.del(
      `company_id=${company_id}&warehouse=true&enableAssignFeature=1`
    );
    cache_connection.del(
      `company_id=${company_id}&warehouse=false&enableAssignFeature=1`
    );
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
    const [result] = await connection.promise().execute(query, values);
    // , function (err, result, fields) {
    // if (err)
    //   return response.status(401).json({
    //     ok: false,
    //     msg: `${err.message}`,
    //   });
    // });
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
        const [result] = await connection.promise().execute(query, values);
        // , function (err, result, fields) {
        //   if (err) {
        //     console.log("error in item final status", err);
        //     return response.status(401).json({
        //       ok: false,
        //       msg: `${err.message}`,
        //     });
        //   }
        // });
        finalResult = [...finalResult, result];
      } else {
        const values = [
          data.status,
          data.condition,
          updated_at,
          data.serial_number,
          event_id,
        ];
        const [result] = await connection.promise().execute(query, values);
        // , function (err, result, fields) {
        //   if (err)
        //     return response.status(401).json({
        //       ok: false,
        //       msg: `${err.message}`,
        //     });
        //   console.log("affected row", result.affectedRows);

        // });
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
    const [result] = await connection.promise().execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });
    //   });
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
    const connection = await getConnection();
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
    const [result] = await connection.promise().execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });
    //   });
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

const checkingItem = async (request, response) => {
  try {
    //company_id=122&warehouse=true&enableAssignFeature=1
    const cache_connection = await clientRedis();
    const params = request._parsedUrl.query;
    const checkingInMemory = await cache_connection.get(`${params}`);
    if (checkingInMemory) {
      return response.status(201).json({
        cached: true,
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
      const [result] = await connection.promise().execute(query, values);
      // , function (err, result, fields) {
      //   if (err)
      //     return response.status(500).json({
      //       ok: false,
      //       msg: `${err.message}`,
      //     });
      //   });
      cache_connection.set(`${params}`, JSON.stringify(result));
      cache_connection.expire(`${params}`, 60);
      return response.status(201).json({
        cached: false,
        ok: true,
        items: result,
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
    const [result] = await connection.promise().execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });
    //   });
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
    const [result] = await connection.promise().execute(query, values);
    // , function (err, result, fields) {
    // if (err)
    //   return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });
    //   });
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
    const cache_connection = await clientRedis();
    const cachedData = await cache_connection.get(
      `inventory_${company_id}_${offset}_${limit}`
    );

    if (cachedData) {
      const responseTemplate = {
        ok: true,
        items: JSON.parse(cachedData),
        cached: true,
      };
      return response.send(JSON.stringify(responseTemplate));
    }

    const query = `
      SELECT * FROM item_inv
      WHERE company_id = ?
      ORDER BY item_id ASC
      LIMIT ?
      OFFSET ?
    `;

    const values = [company_id, limit, offset];
    const [result] = await connection.promise().execute(query, values);
    //   , function (err, result, fields) {
    //   if (err) {
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });
    //   }

    // });
    cache_connection.set(
      `inventory_${company_id}_${offset}_${limit}`,
      JSON.stringify(result)
    );
    cache_connection.expire(`inventory_${company_id}_${offset}_${limit}`, 120);

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
    const cache_connection = await clientRedis();
    const cachedData = await cache_connection.get(`inventory_${company_id}`);
    if (cachedData) {
      const responseTemplate = {
        ok: true,
        items: JSON.parse(cachedData),
        cached: true,
      };
      return response.send(JSON.stringify(responseTemplate));
    }
    // Query to get count by location and count of items where warehouse is true
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
    const [result] = await connection.promise().execute(query, values);
    //   , function (err, result, fields) {
    //   if (err) {
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });
    //   }

    //   // Send the response
    // });
    // Cache the data
    cache_connection.set(`inventory_${company_id}`, JSON.stringify(result));
    cache_connection.expire(`inventory_${company_id}`);
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
    const cache_connection = await clientRedis();
    const cachedData = await cache_connection.get(
      `company_${company_id}_inventory_counting`
    );
    if (cachedData) {
      cache_connection.del(`company_${company_id}_inventory_counting`);
      return response.json({
        statusCode: 200,
        ok: true,
        items: cachedData,
        cached: true,
      });
    }
    const query = `
      SELECT COUNT(*)
      FROM item_inv
      WHERE company_id = ?
    `;
    const values = [company_id];
    const [result] = await connection.promise().execute(query, values);
    await cache_connection.set(
      `company_${company_id}_inventory_counting`,
      JSON.stringify(result)
    );
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
      await connection.promise().execute(query, values);
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
      await connection.promise().execute(query, values);
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
    const [result] = await connection.promise().execute(query, values);
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
        SET warehouse = ? 
        WHERE item_id = ?;
      `;

      const values = [warehouse, item.item_id];

      await connection.promise().execute(query, values);
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
    const [result] = await connection.promise().execute(query, values);
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
    const query = `SELECT * FROM item_inv WHERE ${formatting};`;
    const [result] = await connection.promise().execute(query, values);
    const locations = groupBy(result, "location");
    for (const [key, value] of Object.entries(locations)) {
      const serialNumberListOrderedAsc = orderBy(
        value,
        ["serial_number"],
        ["asc"]
      );

      options.set(key, {
        qty: value.length,
        data: JSON.stringify(value),
        start: serialNumberListOrderedAsc[0].serial_number,
        end: serialNumberListOrderedAsc.at(-1).serial_number,
      });
    }

    return response.status(201).json({
      cached: false,
      ok: true,
      items: Object.fromEntries(options),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      err: error,
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
  fragmentData,
  gettingDataFromLocationOption,
  returningItemToStockWhenEventIsFinishedRefactored,
  itemFinalStatusWhenEventIsFinishedRefactored,
  checkInventoryCompanyExists,
  updateContentInContainerItem,
  updateItemInTableAfterBeingAddedToEventFromContainer,
  checkingIfCompanyHasInventory,
  retrieveItemLocationQuantityForEvent,
};
