const { Router } = require("express");
const { getStaffActivityLogs } = require("../controller/staffActivityLog");
const { validateJWT } = require("../middlewares/validate-jwt");

const router = Router();

// Route to get activity logs
// GET /api/staff-activity-logs?company_id=...&start_date=...
router.get("/", validateJWT, getStaffActivityLogs);

module.exports = router;
