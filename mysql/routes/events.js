/**
 * Auth Route
 * host + /api/db_event
 */

const { Router } = require("express");
const { consultingEventInformation,
    insertingEvent,
    consultingEventTable,
    deleteEvent,
    insertingStaffInEvent,
    consultingEventsPerCompany, 
    consultingInventoryEvent} = require("../controllers/events");
const { insertingItemInEvent, consultingInventoryInEvent, deletingItemsInEventAfterDeviceInventoryIsUpdated } = require("../controllers/items_events");
const { returningItemToStockWhenEventIsFinished, itemFinalStatusWhenEventIsFinished } = require("../controllers/item");
const router = Router();

//check event info
router.post("/consulting-event", consultingEventInformation)

//consulting event
router.post('/events_information', consultingEventTable)

//consulting all events per company
router.post('/events_company', consultingEventsPerCompany)

//insert new event
router.post('/new_event', insertingEvent)

//insert new staff in event
router.post('/event_staff', insertingStaffInEvent)

//insert new devices in event
router.post('/event_device', insertingItemInEvent)

//consulting inventory in event
router.post('/event-inventory/:id', consultingInventoryInEvent)

//returning item to stock after event finished
router.post('/returning-item', returningItemToStockWhenEventIsFinished)

//set final status of device when event finished
router.post('/device-final-status', itemFinalStatusWhenEventIsFinished)

//delete event
router.delete('/:id', deleteEvent)

//consulting all inventory in event
router.get('/event-inventory/:id', consultingInventoryEvent)

//consulting all inventory in event
router.post('/remove-item-inventory-event', deletingItemsInEventAfterDeviceInventoryIsUpdated)

module.exports = router;
