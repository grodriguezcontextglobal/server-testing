const getConnection = require("../database/config");

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

const listCompanyCategories = async (request, response) => {
  try {
    const { company_id } = request.body;
    if (!company_id) {
      return response.status(400).json({ ok: false, msg: "company_id is required" });
    }

    const connection = getConnection();
    const [rows] = await connection.execute(
      `SELECT category_id, category_name, sub_category_name, active, created_at
       FROM company_item_categories
       WHERE company_id = ?
       ORDER BY category_name ASC, sub_category_name ASC`,
      [company_id],
    );

    return response.status(200).json({ ok: true, result: rows });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const upsertCategory = async (request, response) => {
  try {
    const { company_id, category_name, sub_category_name = null, active = 1 } = request.body;

    if (!company_id || !category_name) {
      return response
        .status(400)
        .json({ ok: false, msg: "company_id and category_name are required" });
    }

    const connection = getConnection();
    const [result] = await connection.execute(
      `INSERT INTO company_item_categories (company_id, category_name, sub_category_name, active)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE active = VALUES(active)`,
      [company_id, category_name, sub_category_name, active],
    );

    return response.status(200).json({ ok: true, result });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteCategory = async (request, response) => {
  try {
    const { company_id } = request.body;
    const { category_id } = request.params;

    if (!company_id) {
      return response.status(400).json({ ok: false, msg: "company_id is required" });
    }

    const connection = getConnection();
    const [result] = await connection.execute(
      `UPDATE company_item_categories SET active = 0
       WHERE category_id = ? AND company_id = ?`,
      [category_id, company_id],
    );

    if (result.affectedRows === 0) {
      return response.status(404).json({ ok: false, msg: "Category not found" });
    }

    return response.status(200).json({ ok: true, result });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

// ─── GROUPS ──────────────────────────────────────────────────────────────────

const listCompanyGroups = async (request, response) => {
  try {
    const { company_id } = request.body;
    if (!company_id) {
      return response.status(400).json({ ok: false, msg: "company_id is required" });
    }

    const connection = getConnection();
    const [rows] = await connection.execute(
      `SELECT group_id, item_group, sub_item_group, active, created_at
       FROM company_item_groups
       WHERE company_id = ?
       ORDER BY item_group ASC, sub_item_group ASC`,
      [company_id],
    );

    return response.status(200).json({ ok: true, result: rows });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const upsertGroup = async (request, response) => {
  try {
    const { company_id, item_group, sub_item_group = null, active = 1 } = request.body;

    if (!company_id || !item_group) {
      return response
        .status(400)
        .json({ ok: false, msg: "company_id and item_group are required" });
    }

    const connection = getConnection();
    const [result] = await connection.execute(
      `INSERT INTO company_item_groups (company_id, item_group, sub_item_group, active)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE active = VALUES(active)`,
      [company_id, item_group, sub_item_group, active],
    );

    return response.status(200).json({ ok: true, result });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteGroup = async (request, response) => {
  try {
    const { company_id } = request.body;
    const { group_id } = request.params;

    if (!company_id) {
      return response.status(400).json({ ok: false, msg: "company_id is required" });
    }

    const connection = getConnection();
    const [result] = await connection.execute(
      `UPDATE company_item_groups SET active = 0
       WHERE group_id = ? AND company_id = ?`,
      [group_id, company_id],
    );

    if (result.affectedRows === 0) {
      return response.status(404).json({ ok: false, msg: "Group not found" });
    }

    return response.status(200).json({ ok: true, result });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

// ─── INVENTORY GROUPED WITH SUB-LEVELS ───────────────────────────────────────

/**
 * Returns a flat array of inventory counts broken down by
 * category_name, sub_category_name, item_group, sub_item_group, and location.
 * Clients can build any hierarchy they need from this flat data.
 * Existing /get-inventory-company endpoint is unchanged.
 */
const getInventoryGroupedFull = async (request, response) => {
  try {
    const { company_id } = request.body;
    if (!company_id) {
      return response.status(400).json({ ok: false, msg: "company_id is required" });
    }

    const connection = getConnection();
    const [result] = await connection.execute(
      `SELECT
         category_name,
         sub_category_name,
         item_group,
         sub_item_group,
         location,
         COUNT(*)                                    AS total,
         SUM(warehouse = 1)                          AS available
       FROM item_inv
       WHERE company_id = ?
       GROUP BY category_name, sub_category_name, item_group, sub_item_group, location
       ORDER BY category_name, sub_category_name, item_group, sub_item_group, location`,
      [company_id],
    );

    return response.status(200).json({ ok: true, result });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  listCompanyCategories,
  upsertCategory,
  deleteCategory,
  listCompanyGroups,
  upsertGroup,
  deleteGroup,
  getInventoryGroupedFull,
};
