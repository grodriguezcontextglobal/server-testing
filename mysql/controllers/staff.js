require("dotenv").config();
const getConnection = require("../database/config");
const { v4: uuid } = require("uuid");

const connection = getConnection();

const VALID_ROLE_TYPES = new Set([
  'root_admin', 'admin', 'sale_manager',
  'event_manager', 'inventory_manager', 'assistant',
]);

// Whitelist for consultingStaffMemberInformation column filter
const STAFF_MEMBER_COLUMNS = new Set(['id', 'first_name', 'last_name', 'email', 'phone_number']);

const insertingStaffMember = async (request, response) => {
  try {
    const { first_name, last_name, email, phone_number } = request.body;
    const query = `
      INSERT INTO staff_member (first_name, last_name, email, phone_number)
      VALUES (?, ?, ?, ?)`;
    const values = [first_name, last_name, email, phone_number];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      ok: true,
      member: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const consultingStaffMemberInformation = async (request, response) => {
  try {
    const keys = Object.keys(request.body).filter((k) => STAFF_MEMBER_COLUMNS.has(k));
    if (!keys.length) {
      return response.status(400).json({ ok: false, msg: "No valid filter fields provided" });
    }
    const formatting = keys.map((k) => `${k}=?`).join(" AND ");
    const values = keys.map((k) => request.body[k]);
    const query = `SELECT * FROM staff_member WHERE ${formatting}`;

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      member: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const consultingEventTable = async (request, response) => {
  try {
    const { event_name, zip_address } = request.body;
    const query = `SELECT * FROM event_info WHERE event_name = ? AND zip_address = ?`;
    const values = [event_name, zip_address];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      events: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const deleteEvent = async (request, response) => {
  try {
    const { event_id } = request.body;
    const query = `DELETE FROM event_info WHERE event_id = ?`;
    const values = [event_id];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      deleted: result.affectedRows,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const addCompanyStaff = async (request, response) => {
  try {
    const { company_id, staff_id, role_type, assigned_by } = request.body;
    if (!VALID_ROLE_TYPES.has(role_type)) {
      return response.status(400).json({ ok: false, msg: "Invalid role_type" });
    }

    const [roleRows] = await connection.query(
      "SELECT id FROM roles WHERE role_type = ?",
      [role_type]
    );
    if (!roleRows.length) {
      return response.status(400).json({ ok: false, msg: "Role not found" });
    }

    const [result] = await connection.query(
      "INSERT IGNORE INTO company_staff (id, company_id, staff_id, role_id, is_active, assigned_by) VALUES (?,?,?,?,1,?)",
      [uuid(), company_id, staff_id, roleRows[0].id, assigned_by || null]
    );

    return response.status(201).json({ ok: true, inserted: result.affectedRows });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const updateCompanyStaffRole = async (request, response) => {
  try {
    const { company_id, staff_id, role_type } = request.body;
    if (!VALID_ROLE_TYPES.has(role_type)) {
      return response.status(400).json({ ok: false, msg: "Invalid role_type" });
    }

    const [roleRows] = await connection.query(
      "SELECT id FROM roles WHERE role_type = ?",
      [role_type]
    );
    if (!roleRows.length) {
      return response.status(400).json({ ok: false, msg: "Role not found" });
    }

    const [result] = await connection.query(
      "UPDATE company_staff SET role_id = ? WHERE company_id = ? AND staff_id = ?",
      [roleRows[0].id, company_id, staff_id]
    );

    if (!result.affectedRows) {
      return response.status(404).json({ ok: false, msg: "Staff member not found in company" });
    }

    return response.status(200).json({ ok: true, updated: result.affectedRows });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const getStaffPermissions = async (request, response) => {
  try {
    const { company_id, staff_id } = request.body;

    const [rows] = await connection.query(
      `SELECT r.role_type, r.role_level, p.resource, p.action
       FROM company_staff cs
       JOIN roles r ON cs.role_id = r.id
       JOIN role_permissions rp ON cs.role_id = rp.role_id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE cs.company_id = ? AND cs.staff_id = ? AND cs.is_active = 1
       ORDER BY p.resource, p.action`,
      [company_id, staff_id]
    );

    if (!rows.length) {
      return response.status(404).json({ ok: false, msg: "No active staff record found" });
    }

    const { role_type, role_level } = rows[0];
    const permissions = rows.map(({ resource, action }) => ({ resource, action }));

    return response.status(200).json({ ok: true, role_type, role_level, permissions });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  insertingStaffMember,
  consultingStaffMemberInformation,
  consultingEventTable,
  deleteEvent,
  addCompanyStaff,
  updateCompanyStaffRole,
  getStaffPermissions,
};
