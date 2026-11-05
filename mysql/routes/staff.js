
/**
 * Auth Route
 * host + /api/db_staff
 */

const { Router } = require("express");
const {
  insertingStaffMember,
  consultingStaffMemberInformation,
  addCompanyStaff,
  updateCompanyStaffRole,
  updateCompanyStaff,
  getStaffPermissions,
  getStaffCompanies,
  setCompanyStaffScope,
} = require("../controllers/staff");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { sessionIfValid } = require("../../middlewares/sessionIfValid");
const { authorizePermission } = require("../../middlewares/authorizePermission");
const router = Router();

// Basic staff_member table
// consulting-member: el login la llama antes de guardar el token. Sin sesión
// solo resuelve el staff_id de un email exacto (ver el controlador).
router.post("/consulting-member", sessionIfValid, consultingStaffMemberInformation);
router.post("/new_member", validateJWT, checkTokenVersion, insertingStaffMember);

// company_staff role management (requieren JWT)
// Escribir company_staff da o quita acceso a una compañía: exige staff:create /
// staff:update EN la compañía del body (AC-3, AC-6; 2026-11-04). Antes bastaba
// la sesión y cualquiera se daba de alta como root_admin en otra compañía.
router.post("/company-staff",             validateJWT, checkTokenVersion, authorizePermission("staff", "create"), addCompanyStaff);
router.patch("/company-staff",            validateJWT, checkTokenVersion, authorizePermission("staff", "update"), updateCompanyStaff);
router.patch("/company-staff/role",       validateJWT, checkTokenVersion, authorizePermission("staff", "update"), updateCompanyStaffRole);
router.post("/company-staff/permissions", validateJWT, checkTokenVersion, getStaffPermissions);

// location/category scope assignment (full-replace). Managing who sees what is a
// privileged action → requires the caller to hold staff:update for the company.
router.put("/company-staff/scope", validateJWT, checkTokenVersion, authorizePermission("staff", "update"), setCompanyStaffScope);

// login: lista de empresas del staff con roleType y locations (reemplaza /company/search-company)
router.get("/companies", validateJWT, checkTokenVersion, getStaffCompanies);

module.exports = router;
