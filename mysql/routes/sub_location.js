const { Router } = require("express");
const { check } = require("express-validator");
const validateFields = require("../../middlewares/validate-field");
const {
  createSubLocation,
  getSubLocationsHierarchy,
  updateSubLocation,
  checkSubLocation,
  deleteSubLocation,
} = require("../controllers/sub_location");

const router = Router();

router.post(
  "/sub-locations",
  [
    check("location_id", "Location ID is required").not().isEmpty(),
    check("name", "Name is required").not().isEmpty(),
    validateFields,
  ],
  createSubLocation
);

router.get("/locations/:location_id/sub-locations", getSubLocationsHierarchy);

router.put("/sub-locations/:id", updateSubLocation);

router.post("/sub-locations/check", checkSubLocation);

router.delete("/sub-locations/:id", deleteSubLocation);

module.exports = router;
