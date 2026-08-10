/**
 * Auth Route
 * host + /api/db_item
 */
const express = require("express");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");
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
  retrieveItemLocationQuantityForEvent,
  consultingCompanyInventoryWithPagination,
  consultingCompanyInventoryBasedOnLocationAndSubLocation,
  consultingCompanyInventoryBasedOnSubmittedParameters,
  runNamedInventoryQuery,
  insertBulkItemAlhpanumericFormat,
  getGroupedItemInventory,
  // insertContainerItems,
  deleteBulkItems,
  retrieveItemData,
  deleteBulkItemBasedOnCriteria,
} = require("../controllers/item");
const {
  consultingInventoryCurrentState,
  consultingInventoryInEvent,
  consultingRowInItemInvAssignedEventTable,
  checkingInventoryCurrentState,
  updateEventItemShipping,
  getEventItemShipping,
  removeEventItemShipping,
  bulkUpdateEventItemShipping
} = require("../controllers/items_events");
const router = express.Router();

router.put("/event-items", updateEventItemShipping);
router.post("/event-items/search", getEventItemShipping);
router.delete("/event-items", removeEventItemShipping);
router.put("/event-items/bulk-update", validateJWT, checkTokenVersion, bulkUpdateEventItemShipping);

//delete items in bulk way based on criteria
router.post("/delete-bulk-items-criteria", validateJWT, checkTokenVersion, authorizePermission("inventory", "delete"), deleteBulkItemBasedOnCriteria);

// ✅ Force body parsing to ensure JSON bodies are read
router.use(express.json());

//check item info
router.post("/consulting-item", consultingItem);

//check item in warehouse
router.post("/warehouse-items", validateJWT, consultingItemInWarehouseTable);

//check table
router.post("/items_information", consultingItemTable);

//check inventory current state by query
router.post("/current-inventory", consultingInventoryCurrentState);

//check inventory current state by query
router.post("/inventory_event/:id", consultingInventoryInEvent);

//track item history
router.post("/tracking_item/:id", consultingInventoryTracking);

//insert new item
router.post("/new_item", validateJWT, checkTokenVersion, authorizePermission("inventory", "create"), insertingItem);

//insert bulk item
router.post("/bulk-item", validateJWT, checkTokenVersion, authorizePermission("inventory", "create"), insertBulkItem);

//insert bulk item alpha numeric format
router.post("/bulk-item-alphanumeric", validateJWT, checkTokenVersion, authorizePermission("inventory", "create"), insertBulkItemAlhpanumericFormat);

//update new item
router.post("/edit-item", validateJWT, checkTokenVersion, authorizePermission("inventory", "update"), updateItemInTable);

//updating item in inv after being added to event set up
// Previously ungated. Gated to match the other inventory writes: the event-
// assignment roles (sale_manager L2, event_manager L3) already hold
// inventory:update, so this does not lock them out; scope is enforced in the
// controller. Clients must now send the JWT to this endpoint (frontend coordination).
router.post("/item-out-warehouse", validateJWT, checkTokenVersion, authorizePermission("inventory", "update"), updateItemInWarehouseAfterBeingAddedToEvent);

//updateItemInWarehouseAfterBeingAddedToEvent
//delete item (catch-all POST /:id — must stay authenticated; scope enforced in the controller)
router.post("/:id", validateJWT, checkTokenVersion, authorizePermission("inventory", "delete"), deleteItem);

//delete item in inventory
router.post("/delete-item", validateJWT, checkTokenVersion, authorizePermission("inventory", "delete"), deleteItem);

//bulk delete items
router.post("/delete-bulk-items", validateJWT, checkTokenVersion, authorizePermission("inventory", "delete"), deleteBulkItems);

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
router.post("/check-item", validateJWT, checkingItem);

//get current inventory state
router.get("/check-inventory/:company_id", validateJWT, checkingInventoryCurrentState);

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

//available inventory structured by location with its quantity
router.post(
  "/retrieve-item-location-quantity",
  retrieveItemLocationQuantityForEvent
);

//company inventory pagination
router.post("/inventory-pagination", consultingCompanyInventoryWithPagination);

//company inventory based on location and sublocation
router.post(
  "/inventory-based-on-location-and-sublocation",
  consultingCompanyInventoryBasedOnLocationAndSubLocation
);

// Consulting company inventory based on submitted parameters.
// This handler executes SQL supplied in the request body, so it MUST stay
// authenticated. It was reachable anonymously here (and on /api/db_event),
// while the identical /api/db_company route was gated — anyone on the internet
// could run arbitrary statements against production. Do not remove these.
router.post(
  "/inventory-based-on-submitted-parameters",
  validateJWT,
  checkTokenVersion,
  consultingCompanyInventoryBasedOnSubmittedParameters
);

// Replacement for the route above: the client names a catalog entry instead of
// sending SQL. Mounted on all three routers so call sites can migrate without
// also changing which namespace they post to.
router.post(
  "/inventory-query",
  validateJWT,
  checkTokenVersion,
  runNamedInventoryQuery
);

//get inventory company based on location and sublocation
router.post("/get-inventory-company", getGroupedItemInventory);

router.post("/retrieve-item-data", validateJWT, retrieveItemData);

module.exports = router;
