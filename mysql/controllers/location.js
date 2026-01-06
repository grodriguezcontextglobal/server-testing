const getConnection = require("../database/config");
const logger = require("../../helpers/logger");

const createLocation = async (req, res) => {
  const connection = getConnection();
  const {
    company_id,
    location_name,
    manager_id,
    address_details,
    status
  } = req.body;

  if (!company_id || !location_name) {
    return res.status(400).json({
      ok: false,
      msg: "Missing required fields: company_id, location_name",
    });
  }

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
    address_details ? JSON.stringify(address_details) : null,
    status || 'active'
  ];

  try {
    const [result] = await connection.execute(query, values);
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

  if (!location_id || !item_ids || !Array.isArray(item_ids) || item_ids.length === 0) {
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
      company_id
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
    // List all locations, including empty ones
    // We can also join with item_inv to get a count if needed, but the requirement says "List all locations"
    // Let's include an item count for utility
    const query = `
      SELECT 
        l.*,
        COUNT(i.item_id) as item_count
      FROM locations l
      LEFT JOIN item_inv i ON l.location_id = i.location_id
      WHERE l.company_id = ?
      GROUP BY l.location_id
      ORDER BY l.location_name ASC
    `;

    const [rows] = await connection.execute(query, [company_id]);

    return res.status(200).json({
      ok: true,
      locations: rows,
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
};
