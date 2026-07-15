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
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");

const router = Router();

// insert items into container
// NOTE: only validateJWT/checkTokenVersion (auth), not authorizePermission --
// container_items has no company_id of its own and neither this body nor
// updateContainerItems' body/params carry one; authorizePermission requires
// company_id to look up the caller's role and would 401 every request.
// Real per-company scoping here needs a join through item_inv
// (container_item_id -> item_inv.item_id -> company_id) to derive/verify
// ownership -- tracked as follow-up, see completion report.
router.post("/container-items", validateJWT, checkTokenVersion, insertContainerItems);

router.post("/check-item", validateJWT, checkingItem);

router.get("/container-items/:container_item_id", getContainerItems);

router.delete("/container/:container_item_id", deleteContainerItem);

router.put("/container/:container_item_id", validateJWT, checkTokenVersion, updateContainerItems);

router.post("/check-large-data", validateJWT, checkTokenVersion, authorizePermission("inventory", "read"), checkLargeData);

router.post("/update-location-sub-location", updateSubLocation);

//update large data
router.post("/update-large-data", validateJWT, checkTokenVersion, authorizePermission("inventory", "update"), updateLargeData);

module.exports = router;
