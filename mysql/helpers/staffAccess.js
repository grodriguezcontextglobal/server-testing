const getConnection = require("../database/config");

// Roles that have unrestricted access to all inventory regardless of location assignments.
const FULL_INVENTORY_ROLES = new Set([0, 1, 4]); // root_admin, admin, inventory_manager

/**
 * Looks up a staff member's role and location access for a given company from SQL tables.
 * Never trusts role/preference values submitted by the client.
 *
 * @param {number} sqlStaffId - staff_member.id from the JWT (request.sqlStaffId)
 * @param {number|string} companyId - company_info.id from the request
 * @returns {{ role_type: string, role_level: number, locations: string[] } | null}
 */
const getStaffCompanyAccess = async (sqlStaffId, companyId) => {
  if (!sqlStaffId || !companyId) return null;
  const connection = getConnection();

  const [[staffRow]] = await connection.execute(
    `SELECT cs.id AS company_staff_id, r.role_type, r.role_level
     FROM company_staff cs
     JOIN roles r ON cs.role_id = r.id
     WHERE cs.staff_id = ? AND cs.company_id = ? AND cs.is_active = 1
     LIMIT 1`,
    [sqlStaffId, companyId]
  );
  if (!staffRow) return null;

  // Full-access roles bypass location assignments entirely
  if (FULL_INVENTORY_ROLES.has(staffRow.role_level)) {
    return { role_type: staffRow.role_type, role_level: staffRow.role_level, locations: [] };
  }

  const [locationRows] = await connection.execute(
    `SELECT location_id FROM staff_location_access WHERE company_staff_id = ?`,
    [staffRow.company_staff_id]
  );

  return {
    role_type: staffRow.role_type,
    role_level: staffRow.role_level,
    locations: locationRows.map((r) => r.location_id),
  };
};

module.exports = { getStaffCompanyAccess, FULL_INVENTORY_ROLES };
