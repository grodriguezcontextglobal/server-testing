/**
 * Auth Route
 * host + /api/eventLog
 */

const { Router } = require("express");
const router = Router();

const {
feedEventLog
} = require("../controller/eventLog");

// feed event log
router.post("/feed-event-log", feedEventLog)
module.exports = router;
