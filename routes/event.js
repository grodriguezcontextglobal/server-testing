/**
 * Auth Route
 * host + /api/event
 */

const { Router } = require("express");
const router = Router();
const apicache = require('apicache')
const cache =  apicache.middleware
const {
    createEvent,
    eventList
} = require("../controller/event");

// create an event
router.post("/create-event", createEvent)

//display event list
router.get("/event-list",cache("1 minute"), eventList)
module.exports = router;
