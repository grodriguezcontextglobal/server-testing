require("dotenv").config({ quiet: true });
const getConnection = require("../database/config");
const { randomUUID: uuid } = require("crypto");

const connection = getConnection();

const { VALID_ROLE_TYPES } = require('../constants/roles');
const { LOCATION_SCOPED_ROLES, CATEGORY_SCOPED_ROLES } = require('../helpers/staffAccess');
const { withPlanCapacity, planContextFromRequest } = require('../../helpers/planLimits');

// Tope de staff del plan (2026-11-06): solo cuenta como alta lo que deja a
// alguien ACTIVO que no lo estaba. Un INSERT IGNORE de alguien que ya está, o
// reactivar a quien ya está activo, no suma.
const findCompanyStaffRow = async (company_id, staff_id) => {
  const [rows] = await connection.query(
    "SELECT is_active FROM company_staff WHERE company_id = ? AND staff_id = ? LIMIT 1",
    [company_id, staff_id]
  );
  return rows[0] || null;
};

// Whitelist for consultingStaffMemberInformation column filter
const STAFF_MEMBER_COLUMNS = new Set(['id', 'first_name', 'last_name', 'email', 'phone_number']);

/**
 * Crea el staff_member, o devuelve el que ya existe con ese email.
 *
 * Antes insertaba siempre: un mismo email llegó a tener 9 filas y la
 * resolución de `staff_id` quedaba ambigua — un login con rol scopeado
 * terminó resolviendo al rol equivocado. Con el UNIQUE
 * `uq_staff_member_email` (aplicado 2026-08-18, ver
 * mysql/migrations/dedupe_staff_member_by_email.sql) ese INSERT plano ahora
 * devolvería 1062, así que el endpoint pasa a ser idempotente por email.
 *
 * NO pisa `first_name`/`last_name`/`phone_number` de la fila existente: este
 * endpoint es un alta, no una edición, y un alta repetida con datos peores no
 * debería degradar un registro ya bueno. Para editar está
 * `updatingStaffMemberInformation`.
 *
 * `member.insertId` sigue trayendo el staff_id en ambos casos, para no romper
 * a quien ya leía esa propiedad.
 */
const insertingStaffMember = async (request, response) => {
  try {
    const { first_name, last_name, email, phone_number } = request.body;

    const findByEmail = async () => {
      const [[row]] = await connection.execute(
        "SELECT staff_id FROM staff_member WHERE email = ? LIMIT 1",
        [email]
      );
      return row ? row.staff_id : null;
    };

    const existing = await findByEmail();
    if (existing) {
      return response.status(200).json({
        ok: true,
        created: false,
        staff_id: existing,
        member: { insertId: existing, affectedRows: 0 },
      });
    }

    const query = `
      INSERT INTO staff_member (first_name, last_name, email, phone_number)
      VALUES (?, ?, ?, ?)`;
    const values = [first_name, last_name, email, phone_number];

    let result;
    try {
      [result] = await connection.execute(query, values);
    } catch (error) {
      // Dos requests con el mismo email pasan ambos el SELECT y solo uno gana
      // el INSERT; el que pierde se queda con la fila del ganador.
      if (error?.errno !== 1062 && error?.code !== "ER_DUP_ENTRY") throw error;

      const winner = await findByEmail();
      return response.status(200).json({
        ok: true,
        created: false,
        staff_id: winner,
        member: { insertId: winner, affectedRows: 0 },
      });
    }

    return response.status(201).json({
      ok: true,
      created: true,
      staff_id: result.insertId,
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
    // Sin sesión (login antes de guardar el token): solo email exacto, y solo
    // lo que el login necesita para elegir el staff_id. Antes devolvía nombre,
    // email y teléfono filtrando por cualquier columna. FedRAMP A2, 2026-10-27.
    if (!request.uid) {
      const { email } = request.body || {};
      if (typeof email !== "string" || !email.trim()) {
        return response.status(400).json({ ok: false, msg: "email is required" });
      }
      const [rows] = await connection.execute(
        "SELECT staff_id FROM staff_member WHERE email = ?",
        [email.trim()]
      );
      return response.status(200).json({ ok: true, member: rows });
    }

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

    const existing = await findCompanyStaffRow(company_id, staff_id);
    const capacity = await withPlanCapacity(
      {
        resource: "staff",
        sqlCompanyId: company_id,
        requested: existing ? 0 : 1,
        context: planContextFromRequest(request),
      },
      async () => {
        const [inserted] = await connection.query(
          "INSERT IGNORE INTO company_staff (id, company_id, company_name, staff_id, role_id, is_active, assigned_by) VALUES (?,?,?,?,?,1,?)",
          [uuid(), company_id, company_name || null, staff_id, roleRows[0].id, assigned_by || null]
        );
        return inserted;
      }
    );
    if (capacity.refusal) return response.status(403).json(capacity.refusal);
    const result = capacity.result;

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

    const [categoryRows] = await connection.query(
      `SELECT sca.category_id, cic.category_name, sca.can_create, sca.can_update, sca.can_delete
       FROM staff_category_access sca
       JOIN company_staff cs ON sca.company_staff_id = cs.id
       JOIN company_item_categories cic ON sca.category_id = cic.category_id
       WHERE cs.company_id = ? AND cs.staff_id = ? AND cs.is_active = 1`,
      [company_id, staff_id]
    );

    const categories = categoryRows.map(({ category_id, category_name, can_create, can_update, can_delete }) => ({
      category_id,
      category_name,
      can_create:  Boolean(can_create),
      can_update:  Boolean(can_update),
      can_delete:  Boolean(can_delete),
    }));

    return response.status(200).json({ ok: true, roleType, role_level, permissions, locations, categories });
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

    // Reactivar a alguien inactivo es un alta a efectos del plan.
    let reactivates = false;
    if (is_active === 1) {
      const existing = await findCompanyStaffRow(company_id, staff_id);
      reactivates = Boolean(existing) && Number(existing.is_active) !== 1;
    }
    const capacity = await withPlanCapacity(
      {
        resource: "staff",
        sqlCompanyId: company_id,
        requested: reactivates ? 1 : 0,
        context: planContextFromRequest(request),
      },
      async () => {
        const [updated] = await connection.query(
          `UPDATE company_staff SET ${setClauses.join(", ")} WHERE company_id = ? AND staff_id = ?`,
          values
        );
        return updated;
      }
    );
    if (capacity.refusal) return response.status(403).json(capacity.refusal);
    const result = capacity.result;

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
      `SELECT cs.id AS company_staff_id, cs.company_id, ci.company_name, r.role_type, r.role_level
       FROM company_staff cs
       JOIN roles r ON cs.role_id = r.id
       JOIN company_info ci ON cs.company_id = ci.company_id
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

        const [categoryRows] = await connection.query(
          `SELECT sca.category_id, cic.category_name, sca.can_create, sca.can_update, sca.can_delete
           FROM staff_category_access sca
           JOIN company_item_categories cic ON sca.category_id = cic.category_id
           WHERE sca.company_staff_id = ?`,
          [company_staff_id]
        );

        const categories = categoryRows.map(({ category_id, category_name, can_create, can_update, can_delete }) => ({
          category_id,
          category_name,
          can_create:  Boolean(can_create),
          can_update:  Boolean(can_update),
          can_delete:  Boolean(can_delete),
        }));

        return { company_id, company_name: company_name || null, roleType: role_type, role_level, locations, categories };
      })
    );

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({ ok: true, companies });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

/**
 * Full-replace the location/category scope assignments of a staff member for a
 * company. The dimension is dictated by the staff member's ROLE (never by the
 * client): location-scoped roles (6/7) accept `locations` (location_ids),
 * category-scoped roles (8/9) accept `categories` (category_ids). Ids are
 * validated to belong to the same company before insert (multi-tenant safety).
 *
 * Fail-closed contract: an empty array clears that dimension — since a scoped
 * role with no assignments sees no inventory, the frontend must prevent that,
 * but the backend still allows it (e.g. to intentionally suspend access).
 *
 * host + /api/db_staff/company-staff/scope  (PUT)
 * body: { company_id, staff_id, locations?: number[], categories?: number[] }
 */
const setCompanyStaffScope = async (request, response) => {
  const { company_id, staff_id } = request.body;
  const locations = Array.isArray(request.body.locations) ? request.body.locations : null;
  const categories = Array.isArray(request.body.categories) ? request.body.categories : null;

  if (!company_id || !staff_id) {
    return response.status(400).json({ ok: false, msg: "company_id and staff_id are required" });
  }
  if (locations === null && categories === null) {
    return response.status(400).json({ ok: false, msg: "Provide a locations or categories array" });
  }

  const pool = getConnection();
  const conn = await pool.getConnection();
  try {
    const [[staffRow]] = await conn.query(
      `SELECT cs.id AS company_staff_id, r.role_level
       FROM company_staff cs JOIN roles r ON cs.role_id = r.id
       WHERE cs.company_id = ? AND cs.staff_id = ? AND cs.is_active = 1
       LIMIT 1`,
      [company_id, staff_id]
    );
    if (!staffRow) {
      return response.status(404).json({ ok: false, msg: "Active staff record not found for this company" });
    }

    const { company_staff_id, role_level } = staffRow;
    const isLocationRole = LOCATION_SCOPED_ROLES.has(role_level);
    const isCategoryRole = CATEGORY_SCOPED_ROLES.has(role_level);

    if (!isLocationRole && !isCategoryRole) {
      return response.status(400).json({
        ok: false,
        msg: "Scope can only be assigned to location- or category-scoped roles",
      });
    }
    // Reject the dimension that does not match the role (avoid silent no-ops).
    if (isLocationRole && categories !== null) {
      return response.status(400).json({ ok: false, msg: "This role is location-scoped; send `locations`, not `categories`" });
    }
    if (isCategoryRole && locations !== null) {
      return response.status(400).json({ ok: false, msg: "This role is category-scoped; send `categories`, not `locations`" });
    }

    const dimension = isLocationRole ? "location" : "category";
    const requested = isLocationRole ? locations : categories;

    // Role-based default write flags. Managers (6/8) get full CRUD within scope;
    // assistants (7/9) get update only (read is implicit). Phase C enforces these
    // can_* flags on every write, so an assignment with all-zero flags is read-only.
    // `roleMax` is also the per-assignment CEILING: an override can only turn a flag
    // OFF, never grant a capability the role itself lacks.
    const isManager = role_level === 6 || role_level === 8;
    const roleMax = isManager
      ? { can_create: 1, can_update: 1, can_delete: 1 }
      : { can_create: 0, can_update: 1, can_delete: 0 };
    const clampFlag = (override, max) =>
      max === 0 ? 0 : override === undefined ? max : override ? 1 : 0;

    // Normalize each entry: a bare id -> role defaults; an object
    // ({ id | location_id | category_id, can_* }) -> per-assignment overrides
    // clamped to roleMax. De-dup by id, coerce to positive integers.
    const seen = new Set();
    const entries = [];
    for (const raw of requested || []) {
      const isObj = raw !== null && typeof raw === "object";
      const id = Number(isObj ? raw.id ?? raw[`${dimension}_id`] : raw);
      if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      entries.push({
        id,
        can_create: isObj ? clampFlag(raw.can_create, roleMax.can_create) : roleMax.can_create,
        can_update: isObj ? clampFlag(raw.can_update, roleMax.can_update) : roleMax.can_update,
        can_delete: isObj ? clampFlag(raw.can_delete, roleMax.can_delete) : roleMax.can_delete,
      });
    }
    const ids = entries.map((e) => e.id);

    // Validate the ids belong to this company before touching anything.
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      const [valid] = isLocationRole
        ? await conn.query(
            `SELECT location_id AS id FROM locations WHERE company_id = ? AND location_id IN (${ph})`,
            [company_id, ...ids]
          )
        : await conn.query(
            `SELECT category_id AS id FROM company_item_categories WHERE company_id = ? AND category_id IN (${ph})`,
            [company_id, ...ids]
          );
      const validIds = new Set(valid.map((r) => r.id));
      const invalid = ids.filter((id) => !validIds.has(id));
      if (invalid.length) {
        return response.status(400).json({
          ok: false,
          msg: `Invalid ${dimension} id(s) for this company: ${invalid.join(", ")}`,
        });
      }
    }

    await conn.beginTransaction();
    try {
      if (isLocationRole) {
        await conn.query("DELETE FROM staff_location_access WHERE company_staff_id = ?", [company_staff_id]);
        for (const e of entries) {
          await conn.query(
            "INSERT INTO staff_location_access (id, company_staff_id, location_id, can_create, can_update, can_delete) VALUES (?,?,?,?,?,?)",
            [uuid(), company_staff_id, e.id, e.can_create, e.can_update, e.can_delete]
          );
        }
      } else {
        await conn.query("DELETE FROM staff_category_access WHERE company_staff_id = ?", [company_staff_id]);
        for (const e of entries) {
          await conn.query(
            "INSERT INTO staff_category_access (id, company_staff_id, category_id, can_create, can_update, can_delete) VALUES (?,?,?,?,?,?)",
            [uuid(), company_staff_id, e.id, e.can_create, e.can_update, e.can_delete]
          );
        }
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    }

    return response.status(200).json({
      ok: true,
      dimension,
      assigned: ids.length,
      locations_set: isLocationRole ? ids.length : 0,
      categories_set: isCategoryRole ? ids.length : 0,
      // Write flags applied to bare-id entries (managers CRUD, assistants R/U).
      // Per-assignment overrides, when sent, are clamped to these.
      default_flags: roleMax,
      assignments: entries.map(({ id, can_create, can_update, can_delete }) => ({
        id, can_create: Boolean(can_create), can_update: Boolean(can_update), can_delete: Boolean(can_delete),
      })),
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  } finally {
    conn.release();
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
  setCompanyStaffScope,
};
