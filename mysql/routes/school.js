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
  recordConsent,
  listMemberConsents,
  consentStatus,
} = require("../controllers/school");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { requireIndustry } = require("../../middlewares/requireIndustry");
const { auditPiiAccess } = require("../../middlewares/auditPiiAccess");

const router = Router();

// FERPA/COPPA: record every access to student PII on this namespace (additive —
// logs on response finish via the durable staff-activity log, never blocks).
router.use(auditPiiAccess("SchoolPII"));

const educationOnly = [validateJWT, checkTokenVersion, requireIndustry("Education")];

// 1:1 device-program dashboard: status counts + per-grade breakdown for the company.
router.post("/dashboard", educationOnly, schoolDashboard);

// Student roster (optionally by grade/homeroom) with devices-out per student.
router.post("/roster", educationOnly, schoolRoster);

// Guardians for a student (normalized + the embedded primary).
router.post("/guardians", educationOnly, listStudentGuardians);

// Attach a new guardian to a student.
router.post("/guardians/add", educationOnly, addStudentGuardian);

// Consent / AUP: record a signed policy, list a student's consents, and the
// company-wide compliance status (who has / hasn't signed).
router.post("/consent/record", educationOnly, recordConsent);
router.post("/consent", educationOnly, listMemberConsents);
router.post("/consent/status", educationOnly, consentStatus);

module.exports = router;
