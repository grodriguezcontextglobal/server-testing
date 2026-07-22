/**
 * School (education) namespace — host + /api/school
 *
 * Every route requires an authenticated staff session AND an Education company.
 * The vertical is gated by `company.industry` (requireIndustry), NOT a request
 * keyword — a non-Education tenant can never reach these endpoints.
 */
const { Router } = require("express");
const {
  schoolDashboard,
  schoolRoster,
  listStudentGuardians,
  addStudentGuardian,
} = require("../controllers/school");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { requireIndustry } = require("../../middlewares/requireIndustry");

const router = Router();

const educationOnly = [validateJWT, checkTokenVersion, requireIndustry("Education")];

// 1:1 device-program dashboard: status counts + per-grade breakdown for the company.
router.post("/dashboard", educationOnly, schoolDashboard);

// Student roster (optionally by grade/homeroom) with devices-out per student.
router.post("/roster", educationOnly, schoolRoster);

// Guardians for a student (normalized + the embedded primary).
router.post("/guardians", educationOnly, listStudentGuardians);

// Attach a new guardian to a student.
router.post("/guardians/add", educationOnly, addStudentGuardian);

module.exports = router;
