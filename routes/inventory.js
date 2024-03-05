/**
 * Auth Route
 * host + /api/inventory
 */

const { Router } = require("express");
const { createInventory, editInventory, deleteInventory, listOfInventories } = require("../controller/inventory");
const router = Router();

// create an event
router.post("/create-inventory", createInventory);

//edit/update a specific value of an event
router.patch("/edit-inventory/:id", editInventory)

//edit/update a specific value of an event
router.delete("/delete-inventory/:id", deleteInventory)

//display event list
router.get("/list-inventories", listOfInventories);

module.exports = router;