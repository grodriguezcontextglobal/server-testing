require("dotenv").config();
const getConnection = require("../database/config");
const connection = getConnection();

const VALID_SCOPES = new Set(["location", "sub_location", "category", "group"]);

/**
 * Batch-assign a staff member as manager of one or more scopes
 * (locations, sub-locations, item categories, item groups).
 * body: { company_id, staff_id, assigned_by?, scopes: [{type, ref, label?}] }
 */
const assignInventoryManagers = async (request, response) => {
  try {
    const { company_id, staff_id, assigned_by, scopes } = request.body || {};
    if (!company_id || !staff_id || !Array.isArray(scopes) || !scopes.length) {
      return response.status(400).json({
        ok: false,
        msg: "company_id, staff_id and a non-empty scopes array are required",
      });
    }
    const invalid = scopes.filter((s) => !VALID_SCOPES.has(s?.type) || !s?.ref);
    if (invalid.length) {
      return response.status(400).json({
        ok: false,
        msg: "each scope needs a valid type (location|sub_location|category|group) and ref",
      });
    }
    const values = [];
    for (const s of scopes) {
      values.push(Number(company_id), Number(staff_id), s.type, String(s.ref), s.label ?? null, assigned_by ?? null);
    }
    const [result] = await connection.query(
      `INSERT IGNORE INTO inventory_managers (company_id, staff_id, scope_type, scope_ref, scope_label, assigned_by)
       VALUES ${scopes.map(() => "(?,?,?,?,?,?)").join(",")}`,
      values
    );
    return response.status(201).json({ ok: true, assigned: result.affectedRows });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

/**
 * List all manager assignments for a company (joined with staff identity),
 * plus which parent locations currently have no manager — those are the
 * only scopes where a manager is expected.
 */
const listInventoryManagers = async (request, response) => {
  try {
    const { company_id } = request.body || {};
    if (!company_id) {
      return response.status(400).json({ ok: false, msg: "company_id is required" });
    }
    const [rows] = await connection.query(
      `SELECT im.id, im.scope_type, im.scope_ref, im.scope_label, im.created_at,
              sm.staff_id, sm.first_name, sm.last_name, sm.email
       FROM inventory_managers im
       JOIN staff_member sm ON sm.staff_id = im.staff_id
       WHERE im.company_id = ?
       ORDER BY im.scope_type, im.scope_label`,
      [Number(company_id)]
    );
    const [unmanaged] = await connection.query(
      `SELECT l.location_id, l.location_name
       FROM locations l
       WHERE l.company_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM inventory_managers im
           WHERE im.company_id = l.company_id
             AND im.scope_type = 'location'
             AND im.scope_ref = CAST(l.location_id AS CHAR)
         )
       ORDER BY l.location_name`,
      [Number(company_id)]
    );
    return response.status(200).json({ ok: true, managers: rows, unmanagedLocations: unmanaged });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

/** Remove assignments by id. body: { company_id, ids: [] } */
const removeInventoryManagers = async (request, response) => {
  try {
    const { company_id, ids } = request.body || {};
    if (!company_id || !Array.isArray(ids) || !ids.length) {
      return response.status(400).json({ ok: false, msg: "company_id and ids are required" });
    }
    const [result] = await connection.query(
      `DELETE FROM inventory_managers WHERE company_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
      [Number(company_id), ...ids.map(Number)]
    );
    return response.status(200).json({ ok: true, removed: result.affectedRows });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

module.exports = {
  assignInventoryManagers,
  listInventoryManagers,
  removeInventoryManagers,
};
