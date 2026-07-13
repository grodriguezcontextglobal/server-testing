const { Router } = require("express");
const { check } = require("express-validator");
const validateFields = require("../../middlewares/validate-field");
const {
  createLocation,
  bulkAssignInventory,
  getCompanyLocations,
  deleteLocation,
} = require("../controllers/location");

const router = Router();

router.post(
  "/locations",
  [
    check("company_id", "Company ID is required").not().isEmpty(),
    check("location_name", "Location name is required").not().isEmpty(),
    validateFields,
  ],
  createLocation
);

router.post("/locations/:id", deleteLocation);

router.put(
  "/locations/:id/inventory",
  [
    check("item_ids", "Item IDs array is required").isArray(),
    check("company_id", "Company ID is required").not().isEmpty(),
    validateFields,
  ],
  bulkAssignInventory
);

router.get("/companies/:id/locations", getCompanyLocations);

router.post("/companies/:id/locations", getCompanyLocations);

module.exports = router;
