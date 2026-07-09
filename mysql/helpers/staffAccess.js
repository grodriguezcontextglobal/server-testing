const getConnection = require("../database/config");

// Roles that have unrestricted access to all inventory regardless of location assignments.
const FULL_INVENTORY_ROLES = new Set([0, 1, 4]); // root_admin, admin, inventory_manager

/**
 * Looks up a staff member's role and location access for a given company from SQL tables.
 * Never trusts role/preference values submitted by the client.
 *
 * Rol y locations se resuelven en una sola query (LEFT JOIN + GROUP_CONCAT) en vez de
 * dos idas secuenciales a la DB — este helper corre en el hot path de autorización.
 *
 * @param {number} sqlStaffId - staff_member.id from the JWT (request.sqlStaffId)
 * @param {number|string} companyId - company_info.id from the request
 * @returns {{ role_type: string, role_level: number, locations: string[] } | null}
 */
const getStaffCompanyAccess = async (sqlStaffId, companyId) => {
  if (!sqlStaffId || !companyId) return null;
  const connection = getConnection();

  const [[row]] = await connection.execute(
    `SELECT cs.id AS company_staff_id, r.role_type, r.role_level,
            GROUP_CONCAT(sla.location_id) AS location_ids
     FROM company_staff cs
     JOIN roles r ON cs.role_id = r.id
     LEFT JOIN staff_location_access sla ON sla.company_staff_id = cs.id
     WHERE cs.staff_id = ? AND cs.company_id = ? AND cs.is_active = 1
     GROUP BY cs.id, r.role_type, r.role_level
     LIMIT 1`,
    [sqlStaffId, companyId]
  );
  if (!row) return null;

  // Full-access roles bypass location assignments entirely
  if (FULL_INVENTORY_ROLES.has(row.role_level)) {
    return { role_type: row.role_type, role_level: row.role_level, locations: [] };
  }

  return {
    role_type: row.role_type,
    role_level: row.role_level,
    locations: row.location_ids ? row.location_ids.split(",").map(Number) : [],
  };
};

module.exports = { getStaffCompanyAccess, FULL_INVENTORY_ROLES };
