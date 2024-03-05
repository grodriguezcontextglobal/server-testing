/**
 * Auth Route
 * host + /api/item
 */

const { Router } = require("express");
const { createItem, editItem, deleteItem, listOfItems } = require("../controller/item");
const router = Router();

// create an event
router.post("/create-item", createItem);

//edit/update a specific value of an event
router.patch("/edit-item/:id", editItem)

//edit/update a specific value of an event
router.delete("/delete-item/:id", deleteItem)

//display event list
router.get("/list-items", listOfItems);

//display event list
router.post("/list-items", listOfItems);

module.exports = router;