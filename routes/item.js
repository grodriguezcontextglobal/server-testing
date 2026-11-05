/**
 * Auth Route
 * host + /api/item
 */

const { Router } = require("express");
const { createItem, editItem, deleteItem, listOfItems } = require("../controller/item");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();

// create an event
router.post("/create-item", validateJWT, checkTokenVersion, createItem);

//edit/update a specific value of an event
router.patch("/edit-item/:id", validateJWT, checkTokenVersion, editItem)

//edit/update a specific value of an event
router.delete("/delete-item/:id", validateJWT, checkTokenVersion, deleteItem)

//display event list
router.get("/list-items", validateJWT, checkTokenVersion, listOfItems);

//display event list
router.post("/list-items", validateJWT, checkTokenVersion, listOfItems);

module.exports = router;