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
  searchGuardians,
  recordConsent,
  requestConsent,
  resendConsent,
  publicRetrieveConsent,
  publicRespondConsent,
  listMemberConsents,
  listCompanyConsents,
  consentStatus,
  getSchoolSettings,
  setConsentEnforcement,
  studentExport,
  studentErase,
  studentAccessLog,
  stopLeaseReminders,
  resumeLeaseReminders,
} = require("../controllers/school");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { requireIndustry } = require("../../middlewares/requireIndustry");
const { auditPiiAccess } = require("../../middlewares/auditPiiAccess");
const { authorizePermission } = require("../../middlewares/authorizePermission");

const router = Router();

// FERPA/COPPA: record every access to student PII on this namespace (additive —
// logs on response finish via the durable staff-activity log, never blocks).
router.use(auditPiiAccess("SchoolPII"));

const canRead = [
  validateJWT,
  checkTokenVersion,
  requireIndustry("Education"),
  authorizePermission("member", "read"),
];
const canCreate = [
  validateJWT,
  checkTokenVersion,
  requireIndustry("Education"),
  authorizePermission("member", "create"),
];
const canUpdate = [
  validateJWT,
  checkTokenVersion,
  requireIndustry("Education"),
  authorizePermission("member", "update"),
];

// 1:1 device-program dashboard: status counts + per-grade breakdown for the company.
router.post("/dashboard", canRead, schoolDashboard);

// Student roster (optionally by grade/homeroom) with devices-out per student.
router.post("/roster", canRead, schoolRoster);

// Guardians for a student (normalized + the embedded primary).
router.post("/guardians", canRead, listStudentGuardians);

// Attach a new guardian to a student.
router.post("/guardians/add", canCreate, addStudentGuardian);

// Search guardians by email, member_id, or guardian_id within a company.
router.post("/guardians/search", canRead, searchGuardians);

// Consent / AUP: record a signed policy, list a student's consents, and the
// company-wide compliance status (who has / hasn't signed).
router.post("/consent/record", canCreate, recordConsent);
router.post("/consent/request", canCreate, requestConsent);
router.post("/consent/resend", canCreate, resendConsent);
router.post("/consent/public/retrieve", publicRetrieveConsent);
router.post("/consent/public/respond", publicRespondConsent);
router.post("/consent", canRead, listMemberConsents);
// Company-wide, cualquier estado, con filtro por status y paginación.
router.post("/consent/list", canRead, listCompanyConsents);
router.post("/consent/status", canRead, consentStatus);

// School settings — read + opt-in toggle for consent enforcement (per company).
router.post("/settings", canRead, getSchoolSettings);
router.post("/settings/consent-enforcement", canUpdate, setConsentEnforcement);

// FERPA/COPPA data-subject rights: staff-mediated export and erase/anonymize.
router.post("/student/export", canRead, studentExport);
router.post("/student/erase", canUpdate, studentErase);
router.post("/student/access-log", canRead, studentAccessLog);

// Recordatorios automaticos de vencido: el staff los finaliza (o reanuda) por lease.
router.post("/reminders/stop", canUpdate, stopLeaseReminders);
router.post("/reminders/resume", canUpdate, resumeLeaseReminders);

module.exports = router;
