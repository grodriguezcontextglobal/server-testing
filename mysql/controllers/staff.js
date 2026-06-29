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
    const { company_id, staff_id, role_type, assigned_by, company_name } = request.body;
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
      "INSERT IGNORE INTO company_staff (id, company_id, company_name, staff_id, role_id, is_active, assigned_by) VALUES (?,?,?,?,?,1,?)",
      [uuid(), company_id, company_name || null, staff_id, roleRows[0].id, assigned_by || null]
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

    const { role_type: roleType, role_level } = rows[0];
    const permissions = rows.map(({ resource, action }) => `${resource}:${action}`);

    const [locationRows] = await connection.query(
      `SELECT sla.location_id, l.location_name, sla.can_create, sla.can_update, sla.can_delete
       FROM staff_location_access sla
       JOIN company_staff cs ON sla.company_staff_id = cs.id
       JOIN locations l ON sla.location_id = l.location_id
       WHERE cs.company_id = ? AND cs.staff_id = ? AND cs.is_active = 1`,
      [company_id, staff_id]
    );

    const locations = locationRows.map(({ location_id, location_name, can_create, can_update, can_delete }) => ({
      location_id,
      location:    location_name,
      can_create:  Boolean(can_create),
      can_update:  Boolean(can_update),
      can_delete:  Boolean(can_delete),
    }));

    return response.status(200).json({ ok: true, roleType, role_level, permissions, locations });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const updateCompanyStaff = async (request, response) => {
  try {
    const { company_id, staff_id, is_active, role_type } = request.body;

    if (!company_id || !staff_id) {
      return response.status(400).json({ ok: false, msg: "company_id and staff_id are required" });
    }

    const hasIsActive  = is_active  !== undefined;
    const hasRoleType  = role_type  !== undefined;

    if (!hasIsActive && !hasRoleType) {
      return response.status(400).json({ ok: false, msg: "No field to update — send is_active or role_type" });
    }

    if (hasIsActive && is_active !== 0 && is_active !== 1) {
      return response.status(400).json({ ok: false, msg: "is_active must be 0 or 1" });
    }

    const setClauses = [];
    const values     = [];

    if (hasRoleType) {
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
      setClauses.push("role_id = ?");
      values.push(roleRows[0].id);
    }

    if (hasIsActive) {
      setClauses.push("is_active = ?");
      values.push(is_active);
    }

    values.push(company_id, staff_id);

    const [result] = await connection.query(
      `UPDATE company_staff SET ${setClauses.join(", ")} WHERE company_id = ? AND staff_id = ?`,
      values
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

const getStaffCompanies = async (request, response) => {
  try {
    const sqlStaffId = request.sqlStaffId;

    if (!sqlStaffId) {
      return response.status(401).json({ ok: false, msg: "Unauthorized" });
    }

    const [companyRows] = await connection.query(
      `SELECT cs.id AS company_staff_id, cs.company_id, cs.company_name, r.role_type, r.role_level
       FROM company_staff cs
       JOIN roles r ON cs.role_id = r.id
       WHERE cs.staff_id = ? AND cs.is_active = 1`,
      [sqlStaffId]
    );

    if (!companyRows.length) {
      response.setHeader('Cache-Control', 'no-store');
      return response.status(200).json({ ok: true, companies: [] });
    }

    const companies = await Promise.all(
      companyRows.map(async ({ company_staff_id, company_id, company_name, role_type, role_level }) => {
        const [locationRows] = await connection.query(
          `SELECT sla.location_id, l.location_name, sla.can_create, sla.can_update, sla.can_delete
           FROM staff_location_access sla
           JOIN locations l ON sla.location_id = l.location_id
           WHERE sla.company_staff_id = ?`,
          [company_staff_id]
        );

        const locations = locationRows.map(({ location_id, location_name, can_create, can_update, can_delete }) => ({
          location_id,
          location:    location_name,
          can_create:  Boolean(can_create),
          can_update:  Boolean(can_update),
          can_delete:  Boolean(can_delete),
        }));

        return { company_id, company_name: company_name || null, roleType: role_type, role_level, locations };
      })
    );

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({ ok: true, companies });
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
  updateCompanyStaff,
  getStaffPermissions,
  getStaffCompanies,
};
