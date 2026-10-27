/**
 * Auth Route
 * host + /api/db_consumer_attending_event
 */

const { Router } = require("express");
const { consultingCustomerAttendingEventsInfo, renderAllCustomerByEvent, insertingConsumerAttendingEvent } = require("../controllers/consumerAttendingEvent");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const router = Router();

//check consumer-event info
router.post("/consulting-consumer-event", validateJWT, checkTokenVersion, consultingCustomerAttendingEventsInfo)

//check table
router.post('/consumer-events', validateJWT, checkTokenVersion, renderAllCustomerByEvent)

//insert new consumer-event
router.post('/new_consumer_event', validateJWT, checkTokenVersion, insertingConsumerAttendingEvent)

// //delete consumer-event
// router.delete('/:id')

module.exports = router;
