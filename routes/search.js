/**
 * Auth Route
 * host + /api/admin
 */

const { Router } = require("express");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
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
router.get("/searching_", validateJWT, checkTokenVersion, searching);

//searching consumer
router.get("/searching_consumer", validateJWT, checkTokenVersion, moreConsumer);

//searching events
router.get("/searching_events", validateJWT, checkTokenVersion, moreEvents);

//searching staff
router.get("/searching_staff", validateJWT, checkTokenVersion, moreStaff);

//searching device transaction
router.get("/searching_device_transaction", validateJWT, checkTokenVersion, moreDeviceTransaction);

//searching consumers previous to lastId
router.get("/searching_previous_consumer", validateJWT, checkTokenVersion, previousConsumer);

//advance searching query for inventory projection
router.get("/advance_searching_query", validateJWT, checkTokenVersion, advanceSearchingQuery);

module.exports = router;
