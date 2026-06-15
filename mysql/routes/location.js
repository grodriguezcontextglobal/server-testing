const { Router } = require("express");
const { check } = require("express-validator");
const validateFields = require("../../middlewares/validate-field");
const {
  createLocation,
  bulkAssignInventory,
  getCompanyLocations,
  getCompanyLocationTree,
  deleteLocation,
} = require("../controllers/location");
const { createSubLocationPath, getLocationPathsTree } = require("../controllers/sub_location_paths");

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

router.get("/companies/:id/locations/tree", getCompanyLocationTree);

router.post(
  "/sub-location-path",
  [
    check("company_id", "company_id is required").not().isEmpty(),
    check("location_id", "location_id is required").not().isEmpty(),
    check("sub_location_path", "sub_location_path must be a non-empty array").isArray({ min: 1 }),
    validateFields,
  ],
  createSubLocationPath
);

router.get("/companies/:id/location-paths-tree", getLocationPathsTree);

module.exports = router;
