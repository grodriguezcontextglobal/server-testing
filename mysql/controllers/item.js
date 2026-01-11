const { response, request } = require("express");
const getConnection = require("../database/config");
const { clientRedis } = require("../../database/cacheMemoryConfig");
const { groupBy } = require("lodash");
const logger = require("../../helpers/logger");
const runGoWorker = require("../../helpers/goWorker");
const { processLocation } = require("./location");
const { processSubLocation } = require("./sub_location");
require("dotenv").config();

const insertingItem = async (request, response) => {
  const pool = getConnection();
  const connection = await pool.getConnection(); // Get dedicated connection for transaction
  
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
    manager_id,
    address_details,
    sub_location_name,
    sub_location_parent_id,
    status
  } = request.body;

  try {
    await connection.beginTransaction();

    // 1. Process Location
    // Determine location name from various possible inputs
    const locName = location_name || (typeof location === 'string' ? location : (location?.name || null));
    
    let locationId = null;
    let finalLocationName = locName;

    if (company_id && locName) {
      const locationData = {
        company_id,
        location_name: locName,
        manager_id,
        address_details,
        status
      };
      
      const locResult = await processLocation(connection, locationData);
      locationId = locResult.location_id;
      finalLocationName = locResult.location_name;
    }

    // 2. Process Sub-Location (Optional)
    let subLocationId = null;
    let finalSubLocationName = sub_location; // Default to input

    // Check if we have enough info to create/verify sub-location
    // We need location_id (from step 1) and a sub-location name
    const subLocName = sub_location_name || (typeof sub_location === 'string' ? sub_location : (sub_location?.name || null));

    if (locationId && subLocName) {
        const subLocationData = {
            location_id: locationId,
            name: subLocName,
            parent_id: sub_location_parent_id || (sub_location?.parent_id || null),
            active: true
        };

        // Only process if it looks like a single sub-location name, not a JSON array string
        // If it's a JSON array string like '["A","B"]', we might skip creation or handle differently.
        // For now, we assume simple creation if it's a simple name.
        let isSimpleName = true;
        try {
            const parsed = JSON.parse(subLocName);
            if (Array.isArray(parsed)) isSimpleName = false;
        } catch (e) {
            // Not JSON, so it's a simple string
        }

        if (isSimpleName) {
            const subLocResult = await processSubLocation(connection, subLocationData);
            subLocationId = subLocResult.sub_location_id;
            finalSubLocationName = subLocResult.name;
        }
    }

    // 3. Insert Item
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
        location_id,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Note: We are attempting to insert location_id. 
    // If the column doesn't exist, this will fail. 
    // However, based on location.js bulkAssignInventory, location_id IS used in updates, so it should exist.

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
      finalLocationName, // Legacy location column
      finalSubLocationName, // Legacy sub_location column
      locationId, // New location_id column
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
      supplier_info || null,
    ];

    const [result] = await connection.execute(query, values);

    await connection.commit();

    // Logging
    logger.info(`Item created successfully: ${result.insertId}`, { 
        item_id: result.insertId, 
        company_id, 
        location_id: locationId 
    });

    // await cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=true&enableAssignFeature=1`);
    // await cache_connection
    //   .promise()
    //   .del(`company_id=${company_id}&warehouse=false&enableAssignFeature=1`);

    return response.status(201).json({
      ok: true,
      item: { ...result, location_id: locationId, sub_location_id: subLocationId },
      msg: "Item created successfully"
    });

  } catch (error) {
    await connection.rollback();
    logger.error("insertingItem error:", error);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  } finally {
    connection.release();
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
      supplier_info,
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
      image_url,
      supplier_info
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
      supplier_info,
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
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
      err: error,
    });
  }
};

const insertBulkItemAlhpanumericFormat = async (request, response) => {
  try {
    // Offload to Go Worker
    await runGoWorker("insert-bulk-item-alpha", request.body);

    return response.status(201).json({
      ok: true,
      msg: "Alpha bulk items inserted successfully via Go Worker",
    });
  } catch (error) {
    logger.error("Error in insertBulkItemAlhpanumericFormat:", error);
    response.status(500).json({
      ok: false,
      msg: error.message,
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
    logger.error("Error:", error.message);
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
    logger.error("Error:", error.message);
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
    logger.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const consultingItemInWarehouseTable = async (request, response) => {
  try {
    const connection = getConnection();
    const { role, preference, ...filters } = request.body;

    // Base query construction
    let formatting = Object.keys(filters)
      .map((item) => `${item}=?`)
      .join(" AND ");
    const values = Object.values(filters);

    // Apply location filtering if role is not root admin ("0") and preferences exist
    let locations = [];
    if (Array.isArray(preference)) {
      locations = preference;
    } else if (preference && preference.inventory_location) {
      locations = preference.inventory_location;
    }

    if (role !== "0" && role !== "1" && locations.length > 0) {
      const locationPlaceholders = locations.map(() => "?").join(",");

      if (formatting) {
        formatting += ` AND location IN (${locationPlaceholders})`;
      } else {
        formatting = `location IN (${locationPlaceholders})`;
      }

      values.push(...locations);
    }
    const query = `SELECT * FROM item_inv WHERE ${formatting};`;
    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      ok: true,
      items: result,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
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
      "item_group",
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
        ok: false,
        msg: "Provide at least one identifying field to target the item (e.g., item_id or serial_number with company_id).",
      });
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
        ok: false,
        msg: "No valid fields provided to update.",
      });
    }

    const query = `UPDATE item_inv SET ${setParts.join(
      ", "
    )} WHERE ${whereParts.join(" AND ")};`;
    const values = [...setValues, ...whereValues];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      ok: true,
      items: result,
      updated_fields: setParts.map((u) => u.split(" = ")[0]),
      where_fields: whereParts.map((w) => w.split(" = ")[0]),
    });
  } catch (error) {
    logger.error("Error:", error.message);
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
    logger.error("Error:", error.message);
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
    const { warehouse, company_id, item_group, category_name, data } =
      request.body;
    // Validate request body
    if (
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

    // Prepare the serial numbers for the IN clause
    const serialNumbers = data.map((item) => item.toString());
    const placeholders = serialNumbers.map(() => "?").join(",");

    // Find items query with proper parameterization
    const findIndexQuery = `
      SELECT item_id, serial_number
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
        ok: false,
        msg: "No matching items found",
      });
    }

    // Fix: Keep item_ids as numbers instead of converting to strings
    const itemIds = results.map((item) => item.item_id);

    const idPlaceholders = itemIds.map(() => "?").join(",");

    // Fix: Spread itemIds array in updateValues
    const updateQuery = `
    UPDATE item_inv 
    SET warehouse = ?, update_at = NOW()
    WHERE item_id IN (${idPlaceholders})
    `;

    const updateValues = [warehouse, ...itemIds];
    await connection.execute(updateQuery, updateValues);

    return response.status(201).json({
      ok: true,
      msg: "Items updated successfully",
    });
  } catch (error) {
    logger.error(
      "Error in updateItemInWarehouseAfterBeingAddedToEvent:",
      error
    );
    response.status(500).json({
      ok: false,
      msg: `Server error: ${error.message}`,
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
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

    return response?.status(201)?.json({
      ok: true,
      items: result,
    });
  } catch (error) {
    logger.error("Error:", error.message);
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
    const {
      groupingDevicesFromNoSQL,
      allInventoryOfEvent,
      companyId,
      update_at,
    } = request.body;

    const result = await runGoWorker("returning-item-to-stock", {
      groupingDevicesFromNoSQL: String(groupingDevicesFromNoSQL),
      allInventoryOfEvent: String(allInventoryOfEvent),
      companyId: String(companyId),
      update_at: String(update_at),
    });

    return response.status(201).json({
      ok: true,
      affectedRows: result.affectedRows,
      msg: `Successfully updated ${result.affectedRows} items`,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    logger.error("Stack:", error.stack);
    return response.status(500).json({
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
    SET iiae.status = ?, iiae.condition = ?, iiae.updated_at = ?, active = 0
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
    logger.error("Error:", error.message);
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
    const {
      groupingDevicesFromNoSQL,
      allInventoryOfEvent,
      eventId,
      update_at,
    } = request.body;

    const result = await runGoWorker("item-final-status", {
      groupingDevicesFromNoSQL: String(groupingDevicesFromNoSQL),
      allInventoryOfEvent: String(allInventoryOfEvent),
      eventId: String(eventId),
      update_at: String(update_at),
    });

    return response.status(201).json({
      ok: true,
      affectedRows: result.affectedRows,
      msg: `Successfully updated ${result.affectedRows} items`,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({
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
    logger.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const checkingInventoryCurrentState = async (request, response) => {
  try {
    const company_id = request.params.company_id;
    const { role, preference } = request.query;
    let locations = [];
    if (role !== "0" && role !== "1" && preference) {
      if (Array.isArray(preference)) {
        locations = preference;
      } else {
        try {
          const parsed = JSON.parse(preference);
          if (Array.isArray(parsed)) {
            locations = parsed;
          } else if (parsed.inventory_location) {
            locations = parsed.inventory_location;
          } else {
            locations = [preference];
          }
        } catch (e) {
          locations = [preference];
        }
      }
    }

    const workerResponse = await runGoWorker(
      "checking-inventory-current-state",
      {
        company_id: company_id,
        locations: locations,
      }
    );

    if (workerResponse.status === "error") {
      throw new Error(workerResponse.message);
    }

    return response.status(201).json({
      ok: true,
      result: workerResponse.data,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const checkingItem = async (request, response) => {
  try {
    const { role, preference, ...filters } = request.body;

    // Validate required company_id
    if (!filters.company_id) {
      return response.status(400).json({
        ok: false,
        msg: "company_id is required",
      });
    }

    // Validate filters to prevent undefined values
    const cleanFilters = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) {
        cleanFilters[key] = value;
      }
    }

    const workerPayload = { filters: cleanFilters };

    let locations = [];
    let parsedPreference = preference;

    // Handle stringified preference if it comes as a string
    if (typeof preference === "string") {
      try {
        parsedPreference = JSON.parse(preference);
      } catch (e) {
        // keep original value
      }
    }

    if (Array.isArray(parsedPreference)) {
      locations = parsedPreference;
    } else if (parsedPreference && parsedPreference.inventory_location) {
      locations = parsedPreference.inventory_location;
    }

    if (role && role !== "0" && role !== "1" && locations.length > 0) {
      workerPayload.locations = locations;
    }

    // Explicitly log before calling worker
    const result = await runGoWorker("check-item", workerPayload);

    return response.status(201).json({
      cached: false,
      ok: true,
      items: result,
    });
  } catch (error) {
    logger.error("checkingItem - Error:", error.message);
    return response.status(500).json({
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
    const formattedResult = result.map(row => ({
      location: row.location,
      total_count: Number(row.total_count || 0),
      warehouse_true_count: Number(row.warehouse_true_count || 0)
    }));

    return response.status(201).json({
      ok: true,
      items: formattedResult,
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
    logger.error("Error:", error.message);
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
    logger.error("Error:", error);
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
    logger.error("Error:", error.message);
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
    logger.error("Error:", error.message);
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
    const { company_id, role, preference } = request.body;

    const workerPayload = {
      company_id: String(company_id),
    };

    let locations = [];
    let parsedPreference = preference;

    // Handle stringified preference if it comes as a string
    if (typeof preference === "string") {
      try {
        parsedPreference = JSON.parse(preference);
      } catch (e) {
        logger.warn("Failed to parse preference string:", e.message);
      }
    }

    if (Array.isArray(parsedPreference)) {
      locations = parsedPreference;
    } else if (parsedPreference && parsedPreference.inventory_location) {
      locations = parsedPreference.inventory_location;
    }

    if (role !== "0" && role !== "1" && locations.length > 0) {
      workerPayload.locations = locations;
    }
    const result = await runGoWorker("retrieve-item-data", workerPayload);
    return response.status(200).json({
      ok: true,
      totalAvailable: result.totalAvailable,
      total: result.total,
      groupedData: result.groupedData,
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
      update_at: update_at,
      warehouse: warehouse,
      supplier_info: supplier_info ?? null,
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
      supplier_info,
    } = request.body;
    if (!min_serial_number || !max_serial_number) {
      return response.status(400).json({
        ok: false,
        msg: "Minimum and maximum serial numbers are required.",
      });
    }
    const serialNumbers = [];
    let currentSerial = parseInt(min_serial_number, 10);
    const maxSerial = parseInt(max_serial_number, 10);

    while (currentSerial <= maxSerial) {
      serialNumbers.push(
        currentSerial.toString().padStart(min_serial_number.length, "0")
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
      supplier_info: supplier_info || null,
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
    logger.error("Error:", error.message);
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
      supplier_info,
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
      image_url: image_url || null,
      supplier_info: supplier_info || null,
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
    logger.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

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
        ok: false,
        msg: "Container ID and at least one child ID are required",
      });
    }

    // Validate container_item_id is a number
    if (!Number.isInteger(container_item_id)) {
      return response.status(400).json({
        ok: false,
        msg: "Container ID must be an integer",
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
        ok: false,
        msg: "Error inserting container items",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
    return response.json({
      ok: true,
      msg: "Container items inserted successfully",
      affected_rows: results.affectedRows,
      container_item_id,
      child_ids,
    });
  } catch (error) {
    logger.error("Error in insertContainerItems:", error);
    return response.status(500).json({
      ok: false,
      msg: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
        ok: false,
        msg: "Invalid container_item_id provided",
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
        ok: false,
        msg: "Container not found",
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
        containerResults[0].child_ids
      );
      return response.status(400).json({
        ok: false,
        msg: "Invalid child_ids format in container",
        error: parseError.message,
      });
    }

    if (childIds.length === 0) {
      return response.json({
        ok: true,
        container: {
          container_item_id: parseInt(containerResults[0].container_item_id),
          child_ids: [],
          items: [],
        },
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
      container_item_id: parseInt(containerResults[0].container_item_id),
      child_ids: childIds,
      items: itemsResults.map((item) => ({
        item_id: parseInt(item.item_id),
        id: parseInt(item.item_id),
        item_group: item.item_group,
        serial_number: item.serial_number,
        category_name: item.category_name,
        ownership: item.ownership,
        descript_item: item.descript_item,
        brand: item.brand,
        cost: item.cost,
      })),
    };

    return response.json({
      ok: true,
      container: containerData,
    });
  } catch (error) {
    logger.error("Error in getContainerItems:", error);
    return response.status(500).json({
      ok: false,
      msg: "Error retrieving container items",
      error: error.message,
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
        ok: false,
        msg: "Invalid container_item_id provided",
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
        ok: false,
        msg: "Container not found",
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
        ok: false,
        msg: "Failed to delete container",
      });
    }

    return response.json({
      ok: true,
      msg: "Container deleted successfully",
      container_item_id: parseInt(container_item_id),
    });
  } catch (error) {
    logger.error("Error in deleteContainerItem:", error);
    return response.status(500).json({
      ok: false,
      msg: "Error deleting container",
      error: error.message,
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
        ok: false,
        msg: "Invalid container_item_id provided",
      });
    }

    if (!Array.isArray(child_ids)) {
      return response.status(400).json({
        ok: false,
        msg: "child_ids must be an array",
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
        ok: false,
        msg: "Container not found",
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
        ok: false,
        msg: "Failed to update container",
      });
    }

    return response.json({
      ok: true,
      msg: "Container updated successfully",
      container: {
        container_item_id: parseInt(container_item_id),
        child_ids: child_ids,
      },
    });
  } catch (error) {
    logger.error("Error in updateContainerItems:", error);
    return response.status(500).json({
      ok: false,
      msg: "Error updating container",
      error: error.message,
    });
  }
};

const checkLargeData = async (request, response) => {
  try {
    const connection = getConnection();
    const { item_ids } = request.body;
    const query = `SELECT * FROM item_inv WHERE item_id IN (${item_ids
      .map((item_id) => item_id)
      .join(",")});`;
    const [results] = await connection.execute(query);
    response.status(200).json({
      ok: true,
      result: results,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateLargeData = async (request, response) => {
  try {
    const { item_ids, warehouse } = request.body;

    // Ensure item_ids is an array and not empty
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return response.status(400).json({
        ok: false,
        msg: "item_ids must be a non-empty array",
      });
    }

    const workerResponse = await runGoWorker("update-item-warehouse", {
      item_ids: item_ids,
      warehouse: Number(warehouse),
    });

    if (workerResponse.status === "error") {
      throw new Error(workerResponse.message);
    }

    return response.status(200).json({
      ok: true,
      result: workerResponse.data,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

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
        success: false,
        message:
          "Missing required fields: newName, path (array), currentIndex, and company_id",
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
      
      const [locResult] = await connection.query(updateLocationQuery, [newName, company_id, path[0]]);

      // Backward compatibility: Update item_inv.location (string)
      const updateItemInvQuery = `
        UPDATE item_inv
        SET location = ?
        WHERE company_id = ? AND location = ?
      `;
      await connection.query(updateItemInvQuery, [newName, company_id, path[0]]);

      return res.status(200).json({
        ok: true,
        message: "Location updated successfully",
        affectedRows: locResult.affectedRows,
      });
    }

    // Handle sub_location update (index > 0)
    // For relational structure, we need to find the specific sub_location record and update its name
    // The 'path' array represents the hierarchy: [Location, Sub1, Sub2, ...]
    
    // 1. Find the location_id
    const [locations] = await connection.query(
        "SELECT location_id FROM locations WHERE company_id = ? AND location_name = ?",
        [company_id, path[0]]
    );

    if (locations.length === 0) {
        return res.status(404).json({ ok: false, message: "Location not found" });
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
        
        let query = "SELECT sub_location_id FROM sub_locations WHERE location_id = ? AND name = ?";
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
             return res.status(404).json({ ok: false, message: `Sub-location segment '${nameToFind}' not found in relational structure` });
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
            [newName, targetSubLocationId]
        );
    }

    // Maintain Backward Compatibility: Update JSON in item_inv
    // This logic mimics the original JSON update behavior
    const updateIndex = currentIndex - 1;
    const pathConditions = path
      .slice(1)
      .map(
        (_, index) =>
          `JSON_UNQUOTE(JSON_EXTRACT(sub_location, '$[${index}]')) = ?`
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
      ok: true,
      message: "Sub location updated successfully",
      affectedRows: updateResult.affectedRows,
    });
  } catch (error) {
    logger.error("Error updating sub location:", error);
    return res.status(500).json({
      ok: false,
      message: "Internal server error while updating sub location",
      error: error.message,
    });
  }
};

const getInventoryHierarchyWithTypes = async (request, response) => {
  try {
    const { company_id, role, preference } = request.body;
const connection = getConnection();
    if (!company_id) {
      return response.status(400).json({
        ok: false,
        msg: "company_id is required",
      });
    }

    let query = `
      SELECT 
        item_id, item_group, warehouse, location, sub_location
      FROM item_inv
      WHERE company_id = ?
    `;

    const values = [company_id];

    if (
      role &&
      role !== "0" &&
      role !== "1" &&
      preference &&
      preference.inventory_location &&
      preference.inventory_location.length > 0
    ) {
      const locations = preference.inventory_location;
      const placeholders = locations.map(() => "?").join(",");
      query += ` AND location IN (${placeholders})`;
      values.push(...locations);
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
          warehouse: item.warehouse,
          sub_location:
            typeof item.sub_location === "string"
              ? JSON.parse(item.sub_location)
              : item.sub_location,
        },
      });
    });

    // Build hierarchical structure with types
    const result = {};

    for (const [location, items] of Object.entries(locationGroups)) {
      if (!result[location]) {
        result[location] = {
          total: 0,
          available: 0,
          types: [],
          children: {},
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
          (i) => i?.data?.warehouse === 1
        ).length;

        // Walk through sub_location levels
        let pointer = result[location];

        for (const sub of subLocArray) {
          const subKey = sub || "null";

          if (!pointer.children[subKey]) {
            pointer.children[subKey] = {
              total: 0,
              available: 0,
              types: [],
              children: {},
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
      ok: true,
      data: result,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getGroupedInventoryBySearchParameter = async (request, response) => {
  try {
    const connection = getConnection();
    const { company_id, searchParameter } = request.body;

    if (!company_id) {
      return response.status(400).json({
        ok: false,
        msg: "company_id is required",
      });
    }

    if (!searchParameter) {
      return response.status(400).json({
        ok: false,
        msg: "searchParameter is required",
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
      item_group: {},
      category_name: {},
      brand: {},
      ownership: {},
      main_location: {},
    };

    // Process each item and group by different fields
    items.forEach((item) => {
      const isAvailable = item.warehouse === 1;

      // Group by item_group
      if (item.item_group) {
        if (!result.item_group[item.item_group]) {
          result.item_group[item.item_group] = {
            total: 0,
            available: 0,
          };
        }
        result.item_group[item.item_group].total += 1;
        if (isAvailable) result.item_group[item.item_group].available += 1;
      }

      // Group by category_name
      if (item.category_name) {
        if (!result.category_name[item.category_name]) {
          result.category_name[item.category_name] = {
            total: 0,
            available: 0,
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
            total: 0,
            available: 0,
          };
        }
        result.brand[item.brand].total += 1;
        if (isAvailable) result.brand[item.brand].available += 1;
      }

      // Group by ownership
      if (item.ownership) {
        if (!result.ownership[item.ownership]) {
          result.ownership[item.ownership] = {
            total: 0,
            available: 0,
          };
        }
        result.ownership[item.ownership].total += 1;
        if (isAvailable) result.ownership[item.ownership].available += 1;
      }

      // Group by main_location
      if (item.main_location) {
        if (!result.main_location[item.main_location]) {
          result.main_location[item.main_location] = {
            total: 0,
            available: 0,
          };
        }
        result.main_location[item.main_location].total += 1;
        if (isAvailable)
          result.main_location[item.main_location].available += 1;
      }
    });

    return response.status(200).json({
      ok: true,
      searchParameter,
      totalResults: items.length,
      data: result,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
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
        item.supplier_info !== "undefined"
    );

    return response.status(200).json({
      ok: true,
      result: filteredResult,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const deleteBulkItems = async (request, response) => {
  try {
    const { item_ids, company_id } = request.body;

    // Validate input
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return response.status(400).json({
        ok: false,
        msg: "item_ids must be a non-empty array",
      });
    }

    if (!company_id) {
      return response.status(400).json({
        ok: false,
        msg: "company_id is required",
      });
    }

    const workerResponse = await runGoWorker("delete-bulk-items", {
      item_ids: item_ids,
      company_id: company_id,
    });

    if (workerResponse.status === "error") {
      throw new Error(workerResponse.message);
    }

    return response.status(200).json({
      ok: true,
      result: workerResponse.data,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const ensureIndexes = async (connection) => {
  try {
    const [idxCompany] = await connection.execute(
      "SELECT COUNT(1) AS cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'item_inv' AND index_name = 'idx_item_inv_company_id'"
    );
    if ((idxCompany[0]?.cnt ?? 0) === 0) {
      await connection.query("CREATE INDEX idx_item_inv_company_id ON item_inv (company_id)");
    }
    const [idxLocation] = await connection.execute(
      "SELECT COUNT(1) AS cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'item_inv' AND index_name = 'idx_item_inv_location'"
    );
    if ((idxLocation[0]?.cnt ?? 0) === 0) {
      await connection.query("CREATE INDEX idx_item_inv_location ON item_inv (location)");
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

    if (!company_id || (typeof company_id !== "string" && typeof company_id !== "number")) {
      return response.status(400).json({ ok: false, msg: "company_id is required" });
    }
    if (locations !== undefined && !Array.isArray(locations)) {
      return response.status(400).json({ ok: false, msg: "locations must be an array if provided" });
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
      args
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [rows] = await connection.execute(
      `SELECT * FROM item_inv WHERE ${where} ORDER BY item_id ASC LIMIT ? OFFSET ?`,
      [...args, lim, off]
    );

    const payload = {
      ok: true,
      cached: false,
      metadata: { total, limit: lim, offset: off, returned: rows.length },
      items: rows,
    };

    await cache.set(cacheKey, JSON.stringify(payload));
    await cache.expire(cacheKey, 60);

    return response.status(200).json(payload);
  } catch (error) {
    logger.error("retrieveCompanyItemsWithLocations error:", error);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  retrieveCompanyItemsWithLocations,
  checkingIfCompanyHasInventory,
  checkingInventoryCurrentState,
  checkingItem,
  checkInventoryCompanyExists,
  checkLargeData,
  consultingCompanyInventoryBasedOnLocationAndSubLocation,
  consultingCompanyInventoryBasedOnSubmittedParameters,
  consultingCompanyInventoryWithPagination,
  consultingInventoryTracking,
  consultingItem,
  consultingItemInWarehouseTable,
  consultingItemTable,
  consultItemDataFromSerialNumber,
  deleteContainerItem,
  deleteItem,
  fragmentData,
  getContainerItems,
  getGroupedItemInventory,
  getGroupedItemWithFormatInventory,
  getInventoryHierarchyWithTypes,
  gettingDataFromLocationOption,
  insertBulkItem,
  insertBulkItemAlhpanumericFormat,
  insertContainerItems,
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
  getGroupedInventoryBySearchParameter,
  filterSuppliersInfoItems,
  deleteBulkItems,
};
