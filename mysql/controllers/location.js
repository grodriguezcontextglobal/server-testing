const getConnection = require("../database/config");
const logger = require("../../helpers/logger");
const { getStaffCompanyAccess, FULL_INVENTORY_ROLES } = require("../helpers/staffAccess");

/**
 * Helper to process location data (Find or Create) within a transaction
 * @param {Object} connection - Database connection
 * @param {Object} data - Location data
 * @returns {Object} - { location_id, location_name }
 */
const processLocation = async (connection, data) => {
  const { company_id, location_name, manager_id, address_details, status } =
    data;

  if (!company_id || !location_name) {
    throw new Error(
      "Missing required fields for location: company_id, location_name"
    );
  }

  // Check if location exists
  const [existing] = await connection.execute(
    "SELECT location_id, location_name FROM locations WHERE company_id = ? AND location_name = ?",
    [company_id, location_name]
  );

  if (existing.length > 0) {
    return existing[0];
  }

  // Create new location
  const query = `
    INSERT INTO locations (
      company_id,
      location_name,
      manager_id,
      address_details,
      status
    ) VALUES (?, ?, ?, ?, ?)
  `;

  const values = [
    company_id,
    location_name,
    manager_id || null,
    address_details
      ? typeof address_details === "string"
        ? address_details
        : JSON.stringify(address_details)
      : null,
    status || "active",
  ];

  const [result] = await connection.execute(query, values);

  return {
    location_id: result.insertId,
    location_name: location_name,
  };
};

const createLocation = async (req, res) => {
  const connection = getConnection();
  const { company_id, location_name, manager_id, address_details, status } =
    req.body;

  if (!company_id || !location_name) {
    return res.status(400).json({
      ok: false,
      msg: "Missing required fields: company_id, location_name",
    });
  }

  try {
    const result = await connection.execute(
      "INSERT INTO locations (company_id, location_name, manager_id, address_details, status) VALUES (?, ?, ?, ?, ?)",
      [
        company_id,
        location_name,
        manager_id || null,
        address_details || null,
        status || "active",
      ]
    );

    return res.status(201).json({
      ok: true,
      msg: "Location created successfully",
      location_id: result.insertId,
    });
  } catch (error) {
    logger.error("createLocation error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

const bulkAssignInventory = async (req, res) => {
  const connection = getConnection();
  const { id: location_id } = req.params; // location_id from URL
  const { item_ids, company_id } = req.body;

  if (
    !location_id ||
    !item_ids ||
    !Array.isArray(item_ids) ||
    item_ids.length === 0
  ) {
    return res.status(400).json({
      ok: false,
      msg: "Invalid request. location_id and item_ids array are required.",
    });
  }

  try {
    // Start transaction
    await connection.beginTransaction();

    // 1. Get location details to ensure it exists and get the name for backward compatibility
    const [locations] = await connection.execute(
      "SELECT location_name FROM locations WHERE location_id = ? AND company_id = ?",
      [location_id, company_id]
    );

    if (locations.length === 0) {
      await connection.rollback();
      return res.status(404).json({ ok: false, msg: "Location not found" });
    }

    const location_name = locations[0].location_name;

    // 2. Update item_inv
    // We update both location_id and location (name) for backward compatibility
    const placeholders = item_ids.map(() => "?").join(",");
    const updateQuery = `
      UPDATE item_inv
      SET location_id = ?, location = ?
      WHERE item_id IN (${placeholders}) AND company_id = ?
    `;

    const [result] = await connection.execute(updateQuery, [
      location_id,
      location_name,
      ...item_ids,
      company_id,
    ]);

    await connection.commit();

    return res.status(200).json({
      ok: true,
      msg: "Inventory assigned successfully",
      updated_count: result.affectedRows,
    });
  } catch (error) {
    await connection.rollback();
    logger.error("bulkAssignInventory error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

const getCompanyLocations = async (req, res) => {
  const connection = getConnection();
  const { id: company_id } = req.params;

  try {
    if (!company_id) {
      return res.status(400).json({ ok: false, msg: "Company ID is required" });
    }

    const access = await getStaffCompanyAccess(req.sqlStaffId, company_id);
    if (!access) {
      return res.status(403).json({ ok: false, msg: "Access denied" });
    }

    let locations = [];
    let items = [];

    if (FULL_INVENTORY_ROLES.has(access.role_level)) {
      const [rows] = await connection.execute(
        "SELECT location_id, location_name FROM locations WHERE company_id = ? ORDER BY location_name ASC",
        [company_id]
      );
      locations = rows;
    } else {
      if (access.locations.length === 0) {
        return res.status(200).json({ ok: true, data: {} });
      }
      const placeholders = access.locations.map(() => "?").join(",");
      const [rows] = await connection.execute(
        `SELECT location_id, location_name FROM locations WHERE company_id = ? AND location_id IN (${placeholders}) ORDER BY location_name ASC`,
        [company_id, ...access.locations]
      );
      locations = rows;
    }

    if (locations.length === 0) {
      return res.status(200).json({ ok: true, data: {} });
    }

    const locationIds = locations.map((l) => l.location_id);
    if (locationIds.length === 0) {
      return res.status(200).json({ ok: true, data: {} });
    }

    // 4. Fetch item_inv data
    // Filter items by the allowed location IDs we just retrieved
    const itemPlaceholders = locationIds.map(() => "?").join(",");
    const itemQuery = `
      SELECT location_id, sub_location, item_group, status, warehouse 
      FROM item_inv 
      WHERE company_id = ? 
      AND location_id IN (${itemPlaceholders})
    `;

    const [itemRows] = await connection.execute(itemQuery, [
      company_id,
      ...locationIds,
    ]);
    items = itemRows;

    // 5. Registered sub-locations are the source of truth for the tree —
    //    empty rooms/shelves must appear (zero counts) even with no items.
    const [subLocations] = await connection.execute(
      `SELECT sub_location_id, location_id, name, parent_id
       FROM sub_locations
       WHERE location_id IN (${itemPlaceholders}) AND active = 1
       ORDER BY parent_id, name`,
      locationIds
    );
    const subLocById = {};
    subLocations.forEach((sl) => {
      subLocById[sl.sub_location_id] = {
        total: 0,
        available: 0,
        types: new Set(),
        children: {},
      };
    });
    const rootsByLocation = {};
    subLocations.forEach((sl) => {
      if (!rootsByLocation[sl.location_id]) rootsByLocation[sl.location_id] = {};
      const node = subLocById[sl.sub_location_id];
      if (!sl.parent_id) {
        rootsByLocation[sl.location_id][sl.name] = node;
      } else if (subLocById[sl.parent_id]) {
        subLocById[sl.parent_id].children[sl.name] = node;
      }
    });

    // Initialize Data Structure
    const data = {};
    const locationMap = {};

    locations.forEach((loc) => {
      locationMap[loc.location_id] = loc.location_name;
      data[loc.location_name] = {
        location_id: loc.location_id,
        total: 0,
        available: 0,
        types: new Set(),
        children: rootsByLocation[loc.location_id] ?? {},
      };
    });

    // 6. Process Items
    items.forEach((item) => {
      const locName = locationMap[item.location_id];
      if (!locName || !data[locName]) return;

      // "available" = physically on hand at this location (in stock), i.e. not
// currently checked out to a student/staff. warehouse: 1 = in stock, 0 = out.
      const isAvailable = Number(item.warehouse) === 1;
      const type = item.item_group;

      let parsedSub = [];
      try {
        parsedSub =
          typeof item.sub_location === "string"
            ? JSON.parse(item.sub_location)
            : item.sub_location;
      } catch (e) {
        // Ignore parsing errors
      }

      if (!Array.isArray(parsedSub)) parsedSub = [];

      // Update Root Location Node
      let currentNode = data[locName];
      currentNode.total += 1;
      if (isAvailable) currentNode.available += 1;
      if (type) currentNode.types.add(type);

      // Traverse Sub-Location Path
      parsedSub.forEach((subName) => {
        if (typeof subName !== "string" || !subName.trim()) return;
        const name = subName.trim();

        if (!currentNode.children[name]) {
          currentNode.children[name] = {
            total: 0,
            available: 0,
            types: new Set(),
            children: {},
          };
        }

        // Move down
        currentNode = currentNode.children[name];

        // Update Child Node
        currentNode.total += 1;
        if (isAvailable) currentNode.available += 1;
        if (type) currentNode.types.add(type);
      });
    });

    // 7. Post-Processing
    const processNode = (node) => {
      node.types = Array.from(node.types).sort();

      const childKeys = Object.keys(node.children);
      if (childKeys.length === 0) {
        node.children = null;
      } else {
        childKeys.forEach((key) => {
          processNode(node.children[key]);
        });
      }
    };

    Object.values(data).forEach(processNode);

    return res.status(200).json({
      ok: true,
      data: data,
    });
  } catch (error) {
    logger.error("getCompanyLocations error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

const getCompanyLocationTree = async (req, res) => {
  const connection = getConnection();
  const { id: company_id } = req.params;

  if (!company_id) {
    return res.status(400).json({ ok: false, msg: "Company ID is required" });
  }

  try {
    // 1. Fetch all active locations for the company
    const [locations] = await connection.execute(
      `SELECT location_id, location_name
       FROM locations WHERE company_id = ? AND status = 'active'
       ORDER BY location_name ASC`,
      [company_id]
    );

    if (locations.length === 0) {
      return res.status(200).json({ ok: true, data: {} });
    }

    const locationIds = locations.map((l) => l.location_id);
    const placeholders = locationIds.map(() => "?").join(",");

    // 2. Fetch all sub-locations for those locations (source of truth for the tree)
    const [subLocations] = await connection.execute(
      `SELECT sub_location_id, location_id, name, parent_id
       FROM sub_locations
       WHERE location_id IN (${placeholders}) AND active = 1
       ORDER BY parent_id, name`,
      locationIds
    );

    // 3. Fetch item inventory to compute counts
    const [items] = await connection.execute(
      `SELECT location_id, sub_location, item_group, status, warehouse
       FROM item_inv
       WHERE company_id = ? AND location_id IN (${placeholders})`,
      [company_id, ...locationIds]
    );

    // 4. Build a node for every sub-location keyed by id
    //    children is an object keyed by name so path traversal works the same
    //    way item_inv.sub_location names are matched
    const subLocById = {};
    subLocations.forEach((sl) => {
      subLocById[sl.sub_location_id] = {
        sub_location_id: sl.sub_location_id,
        total: 0,
        available: 0,
        types: new Set(),
        children: {},
        _location_id: sl.location_id,
        _parent_id: sl.parent_id,
        _name: sl.name,
      };
    });

    // rootsByLocation: location_id -> { subLocName -> node }
    const rootsByLocation = {};
    subLocations.forEach((sl) => {
      if (!rootsByLocation[sl.location_id]) rootsByLocation[sl.location_id] = {};
      const node = subLocById[sl.sub_location_id];
      if (!sl.parent_id) {
        rootsByLocation[sl.location_id][sl.name] = node;
      } else if (subLocById[sl.parent_id]) {
        subLocById[sl.parent_id].children[sl.name] = node;
      }
    });

    // 5. Build root data structure keyed by location name
    const locationMap = {};
    const data = {};

    locations.forEach((loc) => {
      locationMap[loc.location_id] = loc.location_name;
      data[loc.location_name] = {
        location_id: loc.location_id,
        total: 0,
        available: 0,
        types: new Set(),
        children: rootsByLocation[loc.location_id] || {},
      };
    });

    // 6. Walk each item, match its sub_location name path through the tree
    //    and accumulate counts at every level it passes through
    items.forEach((item) => {
      const locName = locationMap[item.location_id];
      if (!locName || !data[locName]) return;

      // "available" = physically on hand at this location (in stock), i.e. not
// currently checked out to a student/staff. warehouse: 1 = in stock, 0 = out.
      const isAvailable = Number(item.warehouse) === 1;
      const type = item.item_group;

      let parsedSub = [];
      try {
        parsedSub =
          typeof item.sub_location === "string"
            ? JSON.parse(item.sub_location)
            : item.sub_location;
      } catch (_) {}
      if (!Array.isArray(parsedSub)) parsedSub = [];

      // Always count at the location root
      const locNode = data[locName];
      locNode.total += 1;
      if (isAvailable) locNode.available += 1;
      if (type) locNode.types.add(type);

      // Walk down sub-location path by name
      let currentChildren = locNode.children;
      for (const subName of parsedSub) {
        if (typeof subName !== "string" || !subName.trim()) break;
        const name = subName.trim();
        if (!currentChildren[name]) break; // not registered in sub_locations table
        const subNode = currentChildren[name];
        subNode.total += 1;
        if (isAvailable) subNode.available += 1;
        if (type) subNode.types.add(type);
        currentChildren = subNode.children;
      }
    });

    // 7. Post-process: Set -> sorted array, strip internal fields,
    //    convert empty children {} to null
    const processNode = (node) => {
      node.types = Array.from(node.types).sort();
      delete node._location_id;
      delete node._parent_id;
      delete node._name;

      const childKeys = Object.keys(node.children);
      if (childKeys.length === 0) {
        node.children = null;
      } else {
        childKeys.forEach((key) => processNode(node.children[key]));
      }
    };

    Object.values(data).forEach(processNode);

    return res.status(200).json({ ok: true, data });
  } catch (error) {
    logger.error("getCompanyLocationTree error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

/**
 * Deletes a location by ID
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {string} req.params.id - Location ID to delete
 * @param {Object} res - Express response object
 * @returns {Object} JSON response indicating success or failure
 */
const deleteLocation = async (req, res) => {
  const connection = getConnection();
  const { id: location_id } = req.params;

  if (!location_id) {
    return res.status(400).json({ ok: false, msg: "Location ID is required" });
  }

  try {
    const [result] = await connection.execute(
      "DELETE FROM locations WHERE location_id = ?",
      [location_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, msg: "Location not found" });
    }

    logger.info(`Location deleted successfully: ${location_id}`);

    return res.status(200).json({
      ok: true,
      msg: "Location deleted successfully",
    });
  } catch (error) {
    logger.error("deleteLocation error:", error);
    // Handle foreign key constraint errors
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({
        ok: false,
        msg: "Cannot delete location because it is referenced by other records.",
      });
    }
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

/**
 * Flat list of ALL active locations for a company — the location-dimension
 * counterpart of listCompanyCategories (POST /api/db_company/categories).
 * Intended for admin UIs such as scope assignment: unlike getCompanyLocations,
 * it is NOT filtered by the caller's own inventory scope, so it always returns
 * the full company set. Returns { ok, result: [{ location_id, location_name }] }.
 */
const listCompanyLocations = async (request, response) => {
  try {
    const { company_id } = request.body;
    if (!company_id) {
      return response.status(400).json({ ok: false, msg: "company_id is required" });
    }

    const connection = getConnection();
    const [rows] = await connection.execute(
      `SELECT location_id, location_name
       FROM locations
       WHERE company_id = ? AND status = 'active'
       ORDER BY location_name ASC`,
      [company_id],
    );

    return response.status(200).json({ ok: true, result: rows });
  } catch (error) {
    logger.error("listCompanyLocations error:", error);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  createLocation,
  bulkAssignInventory,
  getCompanyLocations,
  getCompanyLocationTree,
  listCompanyLocations,
  processLocation,
  deleteLocation,
};
