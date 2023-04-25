/**
 * Auth Route
 * host + /api/event
 */

const { Router } = require("express");
const router = Router();
const apicache = require("apicache");
const cache = apicache.middleware;
const { createEvent, eventList } = require("../controller/event");
const accessControlAllowOrigin = require("../middlewares/accessControlAllowOrigin");

// create an event
router.post("/create-event", accessControlAllowOrigin, createEvent);

//display event list
router.get(
  "/event-list",
  accessControlAllowOrigin,
  cache("1 minute"),
  eventList
);
module.exports = router;
