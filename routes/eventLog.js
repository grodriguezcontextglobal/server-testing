/**
 * Auth Route
 * host + /api/event-log
 */

const { Router } = require("express");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();

const {
feedEventLog,
renderActivity
} = require("../controller/eventLog");

// feed event log
router.post("/feed-event-log", validateJWT, checkTokenVersion, feedEventLog)

//display event
router.get("/activity", validateJWT, checkTokenVersion, renderActivity)
module.exports = router;
