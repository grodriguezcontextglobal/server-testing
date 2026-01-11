const getConnection = require("../database/config");
const logger = require("../../helpers/logger");

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
  const { role, preference } = req.body;

  try {
    // 1. Input Validation
    if (!company_id) {
      return res.status(400).json({ ok: false, msg: "Company ID is required" });
    }

    let locations = [];
    let items = [];

    // 2. Determine location filter based on role and preference
    let allowedLocationNames = null; // null means all locations (Admin)

    // Normalize role check: 0 (number) or "0" (string) are Admin
    const isAdmin = role === 0 || role === "0";

    if (!isAdmin) {
      // Non-Admin Role: Check preference.managerLocation
      if (preference && Array.isArray(preference.managerLocation)) {
        // Extract location names from managerLocation array of objects
        // Filter criteria:
        // 1. item exists
        // 2. actions.view is true
        // 3. location is a valid string
        // 4. _id is a valid string (as requested)
        allowedLocationNames = preference.managerLocation
          .filter(
            (item) =>
              item &&
              item.actions &&
              item.actions.view === true &&
              typeof item.location === "string" &&
              item.location.trim().length > 0 &&
              typeof item._id === "string" &&
              item._id.trim().length > 0
          )
          .map((item) => item.location);
      } else {
        // Fallback: No valid preference found for non-admin -> No access
        allowedLocationNames = [];
      }
    }

    // 3. Fetch locations
    if (allowedLocationNames) {
      if (allowedLocationNames.length === 0) {
        return res.status(200).json({ ok: true, data: {} });
      }

      // Use placeholders for safe parameter injection
      const placeholders = allowedLocationNames.map(() => "?").join(",");
      const query = `
        SELECT location_id, location_name 
        FROM locations 
        WHERE company_id = ? 
        AND location_name IN (${placeholders}) 
        ORDER BY location_name ASC
      `;

      const [rows] = await connection.execute(query, [
        company_id,
        ...allowedLocationNames,
      ]);
      locations = rows;
    } else {
      // Admin: Fetch all locations
      const [rows] = await connection.execute(
        "SELECT location_id, location_name FROM locations WHERE company_id = ? ORDER BY location_name ASC",
        [company_id]
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
      SELECT location_id, sub_location, item_group, status 
      FROM item_inv 
      WHERE company_id = ? 
      AND location_id IN (${itemPlaceholders})
    `;

    const [itemRows] = await connection.execute(itemQuery, [
      company_id,
      ...locationIds,
    ]);
    items = itemRows;

    // 5. Initialize Data Structure
    const data = {};
    const locationMap = {};

    locations.forEach((loc) => {
      locationMap[loc.location_id] = loc.location_name;
      data[loc.location_name] = {
        total: 0,
        available: 0,
        types: new Set(),
        children: {},
      };
    });

    // 6. Process Items
    items.forEach((item) => {
      const locName = locationMap[item.location_id];
      if (!locName || !data[locName]) return;

      const isAvailable = item.status === "Operational";
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

module.exports = {
  createLocation,
  bulkAssignInventory,
  getCompanyLocations,
  processLocation,
};
