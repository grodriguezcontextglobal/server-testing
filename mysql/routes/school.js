/**
 * School Route
 * host + /api/school
 *
 * Guardian consent lifecycle for Education companies. Staff routes require an
 * authenticated session and an Education tenant, per
 * FRONTEND_server_updates_2026-07.md §3.
 *
 * The two /public routes are deliberately unauthenticated: a guardian follows
 * a link from an email and has no account. They are guarded by the one-time
 * code instead — only its SHA-256 is stored, it is single-use, and it is
 * cleared the moment a decision is recorded.
 */

const { Router } = require("express");
const getConnection = require("../database/config");
const {
  getSchoolSettings,
  updateConsentEnforcement,
  listGuardians,
  addGuardian,
  searchGuardians,
  getMemberConsent,
  requestConsent,
  resendConsent,
  publicRetrieveConsent,
  publicRespondConsent,
} = require("../controllers/school");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");

const connection = getConnection();

/**
 * Reject non-Education tenants with the 403 the frontend spec documents.
 * Fails closed: a company we can't resolve doesn't get the school namespace.
 */
const requireEducationCompany = async (request, response, next) => {
  try {
    const companyId = request.body?.company_id;
    if (!companyId) {
      return response
        .status(400)
        .json({ ok: false, msg: "company_id is required." });
    }

    const [rows] = await connection.query(
      "SELECT industry FROM company_info WHERE company_id = ?",
      [companyId]
    );

    if (String(rows[0]?.industry ?? "").toLowerCase() !== "education") {
      return response.status(403).json({
        ok: false,
        msg: "Forbidden: this feature is only available to Education companies",
      });
    }

    return next();
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const router = Router();

const staff = [validateJWT, checkTokenVersion, requireEducationCompany];

// ---- settings -------------------------------------------------------------
router.post("/settings", staff, getSchoolSettings);
router.post("/settings/consent-enforcement", staff, updateConsentEnforcement);

// ---- guardians ------------------------------------------------------------
router.post("/guardians", staff, listGuardians);
router.post("/guardians/add", staff, addGuardian);
router.post("/guardians/search", staff, searchGuardians);

// ---- consent (staff) ------------------------------------------------------
router.post("/consent", staff, getMemberConsent);
router.post("/consent/request", staff, requestConsent);
router.post("/consent/resend", staff, resendConsent);

// ---- consent (guardian, no session) ---------------------------------------
router.post("/consent/public/retrieve", publicRetrieveConsent);
router.post("/consent/public/respond", publicRespondConsent);

module.exports = router;
