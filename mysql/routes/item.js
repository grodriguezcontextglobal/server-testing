/**
 * Auth Route
 * host + /api/db_item
 */

const { Router } = require("express");
const {
  consultingItem,
  consultingItemTable,
  insertingItem,
  deleteItem,
  updateItemInTable,
  consultingInventoryTracking,
  consultingItemInWarehouseTable,
  updateItemInWarehouseAfterBeingAddedToEvent,
  insertBulkItem,
} = require("../controllers/item");
const {
  consultingInventoryCurrentState,
  consultingInventoryInEvent,
  consultingRowInItemInvAssignedEventTable,
} = require("../controllers/items_events");
const router = Router();

//check item info
router.post("/consulting-item", consultingItem);

//check item in warehouse
router.post("/warehouse-items", consultingItemInWarehouseTable);

//check table
router.post("/items_information", consultingItemTable);

//check inventory current state by query
router.post("/current-inventory", consultingInventoryCurrentState);

//check inventory current state by query
router.post("/inventory_event/:id", consultingInventoryInEvent);

//track item history
router.post("/tracking_item/:id", consultingInventoryTracking);

//insert new item
router.post("/new_item", insertingItem);

//insert bulk item
router.post("/bulk-item", insertBulkItem);

//update new item
router.post("/edit-item", updateItemInTable);

//updating item in inv after being added to event set up
router.post("/item-out-warehouse", updateItemInWarehouseAfterBeingAddedToEvent);

//updateItemInWarehouseAfterBeingAddedToEvent
//delete item
router.post("/:id", deleteItem);

//delete item in inventory
router.post("/delete-item", deleteItem);

//consulting item inv assigned event table
router.post(
  "/consulting-row-item-assigned-event",
  consultingRowInItemInvAssignedEventTable
);

module.exports = router;
