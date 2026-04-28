/**
 * Auth Route
 * host + /api/db_event
 */

const { Router } = require("express");
const {
  consultingEventInformation,
  insertingEvent,
  updateEventInfo,
  consultingEventTable,
  deleteEvent,
  insertingStaffInEvent,
  consultingEventsPerCompany,
  consultingInventoryEvent,
  updateStatusItemBasedOnEvent,
} = require("../controllers/events");
const {
  insertingItemInEvent,
  consultingInventoryInEvent,
  deletingItemsInEventAfterDeviceInventoryIsUpdated,
  insertingDeviceInEventDirectly,
  insertingDeviceInEventDirectlyFromContainer,
  allocateDeviceToEvent,
  allocateDeviceMarkedAsContainerInEvent,
  lockItemsForEvent,
  reserveItemsInInventoryForEvent,
} = require("../controllers/items_events");
const {
  returningItemToStockWhenEventIsFinished,
  itemFinalStatusWhenEventIsFinished,
  returningItemToStockWhenEventIsFinishedRefactored,
  itemFinalStatusWhenEventIsFinishedRefactored,
  updateItemInTableAfterBeingAddedToEventFromContainer,
  retrieveItemLocationQuantityForEvent,
  consultItemDataFromSerialNumber,
  getGroupedItemInventory,
  getGroupedItemWithFormatInventory,
  consultingCompanyInventoryBasedOnSubmittedParameters,
  confirmItemsReturnedToStock,
} = require("../controllers/item");
const router = Router();

//check event info
router.post("/consulting-event", consultingEventInformation);

//consulting event
router.post("/events_information", consultingEventTable);

//consulting all events per company
router.post("/events_company", consultingEventsPerCompany);

//insert new event
router.post("/new_event", insertingEvent);

//update event info
router.post("/update-event/:event_id", updateEventInfo);

//insert new staff in event
router.post("/event_staff", insertingStaffInEvent);

//insert new devices in event
router.post("/event_device", insertingItemInEvent);

//insert new devices in event directly
router.post("/event_device_directly", insertingDeviceInEventDirectly);

//consulting inventory in event
router.post("/event-inventory/:id", consultingInventoryInEvent);

//returning item to stock after event finished
router.post("/returning-item", returningItemToStockWhenEventIsFinished);

//returning item to stock after event finished (refactored)
router.post(
  "/returning-item-refactored",
  returningItemToStockWhenEventIsFinishedRefactored,
);

router.post("/confirm-item-return", confirmItemsReturnedToStock);

//set final status of device when event finished
router.post("/device-final-status", itemFinalStatusWhenEventIsFinished);

//set final status of device when event finished (refactored)
router.post(
  "/device-final-status-refactored",
  itemFinalStatusWhenEventIsFinishedRefactored,
);
//delete event
router.delete("/:id", deleteEvent);

//consulting all inventory in event
router.get("/event-inventory/:id", consultingInventoryEvent);

//consulting all inventory in event
router.post(
  "/remove-item-inventory-event",
  deletingItemsInEventAfterDeviceInventoryIsUpdated,
);

//update status of item based on event
router.post("/update-status-item-based-on-event", updateStatusItemBasedOnEvent);

//update item in table after being added to event from container
router.post(
  "/update-item-in-table-after-being-added-to-event-from-container",
  updateItemInTableAfterBeingAddedToEventFromContainer,
);

//inserting items in event from container item
router.post(
  "/inserting-items-in-event-from-container",
  insertingDeviceInEventDirectlyFromContainer,
);

//retrieve inventory structured by location with its quantity
router.post(
  "/retrieve-item-location-quantity",
  retrieveItemLocationQuantityForEvent,
);

//retrieve inventory structured by location with its quantity full details
router.post(
  "/retrieve-item-location-quantity-full-details",
  consultItemDataFromSerialNumber,
);

//retrieve inventory structured by item group with its location and its quantity
router.post("/retrieve-item-group-location-quantity", getGroupedItemInventory);

//retrieve inventory structured by item group with its location and its quantity and more columns defined
router.post(
  "/retrieve-item-group-quantity-with-format",
  getGroupedItemWithFormatInventory,
);

//consulting company inventory based on submitted parameters
router.post(
  "/inventory-based-on-submitted-parameters",
  consultingCompanyInventoryBasedOnSubmittedParameters,
);

//allocate
router.post("/allocate-device-event", allocateDeviceToEvent);

router.post(
  "/allocate-device-container-event",
  allocateDeviceMarkedAsContainerInEvent,
);

//reserve items in inventory for event
router.post("/reserve-items-for-event", reserveItemsInInventoryForEvent);

//lock items to be used in event
router.post("/lock-items-for-event", lockItemsForEvent);

module.exports = router;
