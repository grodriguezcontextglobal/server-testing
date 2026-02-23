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
  updateLargeNumberOfEventsAtOnce,
  updateGlobalStateOfEvent,
} = require("../controller/event");
const { getListOfUsersAndTransactionsPerEvent } = require("../controller/auth");
const { validateJWT } = require("../middlewares/validate-jwt");

// create an event
router.post("/create-event", validateJWT, createEvent);

//edit event
router.put("/edit-event/:id", validateJWT, editSubscriptionEvent);

//edit/update a specific value of an event
router.patch("/edit-event/:id", validateJWT, editSubscriptionEvent);

//edit staff event
router.patch("/edit-staff-event/:id", validateJWT, editEvent);

//display event list
router.get("/event-list", eventList);

//display event by parameters
router.post("/event-list", eventList);

//event list per company
router.get("/event-list-per-company", gettingEventListPerCompany);

router.post("/staff-all-events", searchStaffAllEvents);

//all consumers and transactions per event
router.get(
  "/all-users-and-transactions-per-event",
  getListOfUsersAndTransactionsPerEvent
);

//retrieve staff info in detail of an event
router.get("/event-staff-detail/:id", eventStaffDetailInfo);

//check event inventory based on timeframe selected
router.get("/event-inventory-based-on-period", inventoryEventBasedOnPeriod);

// delete event
router.delete("/delete-event/:id", validateJWT, deleteEvent);

//update large number of events at once
router.patch("/update-events", updateLargeNumberOfEventsAtOnce);

router.post("/update-global-state", updateGlobalStateOfEvent)
module.exports = router;
