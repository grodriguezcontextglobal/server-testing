/**
 * Auth Route
 * host + /api/event
 */

const { Router } = require("express");
const router = Router();

const {
    createEvent,
    eventList
} = require("../controller/event");

// create an event
router.post("/create-event", createEvent)

//display event list
router.get("/event-list", eventList)
module.exports = router;
