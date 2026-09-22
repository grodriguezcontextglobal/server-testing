/**
 * host + /api/db_inventory_manager
 * Scoped inventory managers (locations / sub-locations / categories / groups).
 */
const { Router } = require("express");
const {
  assignInventoryManagers,
  listInventoryManagers,
  removeInventoryManagers,
} = require("../controllers/inventoryManagers");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");

const router = Router();
const canManage = [validateJWT, checkTokenVersion, authorizePermission("inventory", "update")];
const canRead = [validateJWT, checkTokenVersion, authorizePermission("inventory", "read")];

router.post("/assign", canManage, assignInventoryManagers);
router.post("/list", canRead, listInventoryManagers);
router.post("/remove", canManage, removeInventoryManagers);

module.exports = router;
