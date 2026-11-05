const { Router } = require("express");
const { createShipment, updateShipment, deleteShipment, getShipments, retrievePackageList } = require("../controllers/shipment");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");

const router = Router();

router.post("/", validateJWT, checkTokenVersion, createShipment);
router.put("/:shipment_id", validateJWT, checkTokenVersion, updateShipment);
router.delete("/:shipment_id", validateJWT, checkTokenVersion, deleteShipment);
router.post("/search", validateJWT, checkTokenVersion, getShipments);
router.post("/package-list", validateJWT, checkTokenVersion, retrievePackageList);

module.exports = router;