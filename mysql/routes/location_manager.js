const express = require("express");
const {
  assignManager,
  getManagers,
  removeManager,
} = require("../controllers/location_manager");

const router = express.Router();

router.use(express.json());

// Assign a manager to a location
router.post("/assign", assignManager);

// Get managers (query params: company_id, location_name)
router.get("/", getManagers);

// Remove a manager
router.delete("/remove", removeManager);

module.exports = router;
