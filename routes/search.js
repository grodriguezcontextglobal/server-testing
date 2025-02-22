/**
 * Auth Route
 * host + /api/admin
 */

const { Router } = require("express");
const {
  searching,
  moreConsumer,
  moreEvents,
  moreStaff,
  moreDeviceTransaction,
  previousConsumer,
  advanceSearchingQuery,
} = require("../controller/search");
const router = Router();

//general searching information at first calls
router.get("/searching_", searching);

//searching consumer
router.get("/searching_consumer", moreConsumer);

//searching events
router.get("/searching_events", moreEvents);

//searching staff
router.get("/searching_staff", moreStaff);

//searching device transaction
router.get("/searching_device_transaction", moreDeviceTransaction);

//searching consumers previous to lastId
router.get("/searching_previous_consumer", previousConsumer);

//advance searching query for inventory projection
router.get("/advance_searching_query", advanceSearchingQuery);

module.exports = router;
