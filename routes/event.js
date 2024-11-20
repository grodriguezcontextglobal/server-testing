/**
 * Auth Route
 * host + /api/event
 */

const { Router } = require("express");
const router = Router();
const {
    createEvent,
    eventList,
    editSubscriptionEvent,
    editEvent,
    searchStaffAllEvents,
    gettingEventListPerCompany
} = require("../controller/event");

// create an event
router.post("/create-event", createEvent);

//edit event
router.put("/edit-event/:id", editSubscriptionEvent)

//edit/update a specific value of an event
router.patch("/edit-event/:id", editSubscriptionEvent)

//edit staff event
router.patch("/edit-staff-event/:id", editEvent)

//display event list
router.get(
  "/event-list",
  eventList
);

//display event by parameters
router.post(
  "/event-list",
  eventList
);

//event list per company
router.get('/event-list-per-company', gettingEventListPerCompany)

router.post("/staff-all-events", searchStaffAllEvents);

module.exports = router;
