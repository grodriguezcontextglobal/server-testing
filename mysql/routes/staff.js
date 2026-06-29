
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
  getStaffPermissions,
  getStaffCompanies,
} = require("../controllers/staff");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const router = Router();

// Basic staff_member table
router.post("/consulting-member", consultingStaffMemberInformation);
router.post("/new_member", insertingStaffMember);

// company_staff role management (requieren JWT)
router.post("/company-staff",             validateJWT, checkTokenVersion, addCompanyStaff);
router.patch("/company-staff/role",       validateJWT, checkTokenVersion, updateCompanyStaffRole);
router.post("/company-staff/permissions", validateJWT, checkTokenVersion, getStaffPermissions);

// login: lista de empresas del staff con roleType y locations (reemplaza /company/search-company)
router.get("/companies", validateJWT, checkTokenVersion, getStaffCompanies);

module.exports = router;
