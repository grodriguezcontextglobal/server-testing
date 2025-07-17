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
} = require("../controllers/item");

const router = Router();

// insert items into container
router.post("/container-items", insertContainerItems);

router.get("/container-items/:container_item_id", getContainerItems);

router.delete("/container/:container_item_id", deleteContainerItem);

router.put("/container/:container_item_id", updateContainerItems);

router.post("/check-large-data", checkLargeData);

router.post("/update-large-data", checkLargeData);

router.post("/update-location-sub-location", updateSubLocation);

module.exports = router;
