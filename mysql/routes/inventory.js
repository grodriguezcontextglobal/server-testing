/**
 * Auth Route
 * host + /api/db_inventory
 */

const { Router } = require("express");
const {
  insertContainerItems,
  getContainerItems,
  deleteContainerItem,
  updateContainerItems,
  checkLargeData,
  updateSubLocation,
  updateLargeData,
  checkingItem,
} = require("../controllers/item");

const router = Router();

// insert items into container
router.post("/container-items", insertContainerItems);

router.post("/check-item", checkingItem);

router.get("/container-items/:container_item_id", getContainerItems);

router.delete("/container/:container_item_id", deleteContainerItem);

router.put("/container/:container_item_id", updateContainerItems);

router.post("/check-large-data", checkLargeData);

router.post("/update-large-data", checkLargeData);

router.post("/update-location-sub-location", updateSubLocation);

//update large data
router.post("/update-large-data", updateLargeData);

module.exports = router;
