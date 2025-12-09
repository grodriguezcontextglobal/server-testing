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
    gettingEventListPerCompany,
    eventStaffDetailInfo,
    inventoryEventBasedOnPeriod,
    deleteEvent,
    updateLargeNumberOfEventsAtOnce
} = require("../controller/event");
const { getListOfUsersAndTransactionsPerEvent } = require("../controller/auth");

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

//all consumers and transactions per event
router.get("/all-users-and-transactions-per-event", getListOfUsersAndTransactionsPerEvent);

//retrieve staff info in detail of an event
router.get('/event-staff-detail/:id', eventStaffDetailInfo)

//check event inventory based on timeframe selected
router.get('/event-inventory-based-on-period', inventoryEventBasedOnPeriod)

// delete event
router.delete("/delete-event/:id", deleteEvent);

//update large number of events at once
router.patch("/update-events", updateLargeNumberOfEventsAtOnce);

module.exports = router;
