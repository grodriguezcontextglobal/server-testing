/**
 * Auth Route
 * host + /api/db_consumer_attending_event
 */

const { Router } = require("express");
const { consultingCustomerAttendingEventsInfo, renderAllCustomerByEvent, insertingConsumerAttendingEvent } = require("../controllers/consumerAttendingEvent");
const router = Router();

//check consumer-event info
router.post("/consulting-consumer-event", consultingCustomerAttendingEventsInfo)

//check table
router.post('/consumer-events', renderAllCustomerByEvent)

//insert new consumer-event
router.post('/new_consumer_event', insertingConsumerAttendingEvent)

// //delete consumer-event
// router.delete('/:id')

module.exports = router;
