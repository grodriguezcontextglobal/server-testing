const { Router } = require("express");
const { createShipment, updateShipment, deleteShipment, getShipments, retrievePackageList } = require("../controllers/shipment");

const router = Router();

router.post("/", createShipment);
router.put("/:shipment_id", updateShipment);
router.delete("/:shipment_id", deleteShipment);
router.post("/search", getShipments);
router.post("/package-list", retrievePackageList);

module.exports = router;