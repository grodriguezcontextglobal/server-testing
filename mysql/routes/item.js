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
  searchingInventoryTracking,
  checkingItem,
  searchingGetInventoryTracking,
  fragmentData,
  gettingDataFromLocationOption,
  returningItemToStockWhenEventIsFinishedRefactored,
  checkingIfCompanyHasInventory,
} = require("../controllers/item");
const {
  consultingInventoryCurrentState,
  consultingInventoryInEvent,
  consultingRowInItemInvAssignedEventTable,
  checkingInventoryCurrentState,
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

//searching function
router.post("/search-inventory", searchingInventoryTracking);

//searching inventory
router.get("/search-inventory", searchingGetInventoryTracking);

//get item info
router.get("/check-item", checkingItem);

//get current inventory state
router.get("/check-inventory", checkingInventoryCurrentState);

//get fragment data
router.get("/fragment-data", fragmentData);

//get location and count data
router.get("/location-count", gettingDataFromLocationOption);

//returning item to stock after event finished (refactored)
router.post(
  "/returning-item-refactored",
  returningItemToStockWhenEventIsFinishedRefactored
);

//check if company has inventory
router.get("/check-company-has-inventory", checkingIfCompanyHasInventory);
module.exports = router;
