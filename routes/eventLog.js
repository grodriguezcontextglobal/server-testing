/**
 * Auth Route
 * host + /api/event-log
 */

const { Router } = require("express");
const router = Router();

const {
feedEventLog,
renderActivity
} = require("../controller/eventLog");

// feed event log
router.post("/feed-event-log", feedEventLog)

//display event
router.get("/activity", renderActivity)
module.exports = router;
