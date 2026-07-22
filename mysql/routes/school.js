/**
 * School (education) namespace — host + /api/school
 *
 * Every route requires an authenticated staff session AND an Education company.
 * The vertical is gated by `company.industry` (requireIndustry), NOT a request
 * keyword — a non-Education tenant can never reach these endpoints.
 */
const { Router } = require("express");
const { schoolDashboard } = require("../controllers/school");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { requireIndustry } = require("../../middlewares/requireIndustry");

const router = Router();

const educationOnly = [validateJWT, checkTokenVersion, requireIndustry("Education")];

// 1:1 device-program dashboard: status counts + per-grade breakdown for the company.
router.post("/dashboard", educationOnly, schoolDashboard);

module.exports = router;
