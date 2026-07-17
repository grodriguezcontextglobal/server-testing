const getConnection = require("../database/config");

// Roles that have unrestricted access to all inventory regardless of location/category assignments.
const FULL_INVENTORY_ROLES = new Set([0, 1, 4]); // root_admin, admin, inventory_manager

// Roles constrained to their explicit location/category assignments. Unlike the
// other non-full roles (sale_manager, event_manager, assistant), these are
// fail-closed: a scoped role with zero assignments sees NO inventory (enforced by
// the controllers in Phase 4). Levels 6/7 are location-scoped; 8/9 category-scoped.
const SCOPED_ROLES = new Set([6, 7, 8, 9]);

/**
 * Looks up a staff member's role and location/category access for a given company
 * from SQL tables. Never trusts role/preference values submitted by the client.
 *
 * Rol, locations y categories se resuelven en una sola query (LEFT JOIN +
 * GROUP_CONCAT DISTINCT) en vez de varias idas secuenciales a la DB — este helper
 * corre en el hot path de autorización. Los dos LEFT JOIN producen un producto
 * cartesiano, por eso el DISTINCT dentro de cada GROUP_CONCAT es obligatorio.
 *
 * item_inv se filtra por category_name (no tiene columna category_id), así que los
 * category_id asignados se resuelven a nombres con una segunda query — sólo cuando
 * el rol tiene categorías asignadas, dejando el resto del hot path en una sola query.
 *
 * @param {number} sqlStaffId - staff_member.id from the JWT (request.sqlStaffId)
 * @param {number|string} companyId - company_info.id from the request
 * @returns {{ role_type: string, role_level: number, scoped: boolean,
 *   locations: number[], categories: number[], categoryNames: string[] } | null}
 */
const getStaffCompanyAccess = async (sqlStaffId, companyId) => {
  if (!sqlStaffId || !companyId) return null;
  const connection = getConnection();

  const [[row]] = await connection.execute(
    `SELECT cs.id AS company_staff_id, r.role_type, r.role_level,
            GROUP_CONCAT(DISTINCT sla.location_id) AS location_ids,
            GROUP_CONCAT(DISTINCT sca.category_id) AS category_ids
     FROM company_staff cs
     JOIN roles r ON cs.role_id = r.id
     LEFT JOIN staff_location_access sla ON sla.company_staff_id = cs.id
     LEFT JOIN staff_category_access sca ON sca.company_staff_id = cs.id
     WHERE cs.staff_id = ? AND cs.company_id = ? AND cs.is_active = 1
     GROUP BY cs.id, r.role_type, r.role_level
     LIMIT 1`,
    [sqlStaffId, companyId]
  );
  if (!row) return null;

  const roleLevel = row.role_level;

  // Full-access roles bypass location/category assignments entirely.
  if (FULL_INVENTORY_ROLES.has(roleLevel)) {
    return {
      role_type: row.role_type,
      role_level: roleLevel,
      scoped: false,
      locations: [],
      categories: [],
      categoryNames: [],
    };
  }

  const locations = row.location_ids ? row.location_ids.split(",").map(Number) : [];
  const categories = row.category_ids ? row.category_ids.split(",").map(Number) : [];

  // Resolve assigned category ids -> names for item_inv filtering. Only fires for
  // staff that actually have category assignments (category-scoped roles).
  let categoryNames = [];
  if (categories.length > 0) {
    const placeholders = categories.map(() => "?").join(",");
    const [nameRows] = await connection.execute(
      `SELECT DISTINCT category_name FROM company_item_categories
       WHERE company_id = ? AND category_id IN (${placeholders})`,
      [companyId, ...categories]
    );
    categoryNames = nameRows.map((r) => r.category_name);
  }

  return {
    role_type: row.role_type,
    role_level: roleLevel,
    scoped: SCOPED_ROLES.has(roleLevel),
    locations,
    categories,
    categoryNames,
  };
};

module.exports = { getStaffCompanyAccess, FULL_INVENTORY_ROLES, SCOPED_ROLES };
