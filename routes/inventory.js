/**
 * Auth Route
 * host + /api/inventory
 */

const { Router } = require("express");
const { createInventory, editInventory, deleteInventory, listOfInventories } = require("../controller/inventory");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();

// create an event
router.post("/create-inventory", validateJWT, checkTokenVersion, createInventory);

//edit/update a specific value of an event
router.patch("/edit-inventory/:id", validateJWT, checkTokenVersion, editInventory)

//edit/update a specific value of an event
router.delete("/delete-inventory/:id", validateJWT, checkTokenVersion, deleteInventory)

//display event list
router.get("/list-inventories", validateJWT, checkTokenVersion, listOfInventories);

module.exports = router;