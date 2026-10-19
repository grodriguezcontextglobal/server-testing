
/**
 * Auth Route
 * host + /api/db_stripe
 */

const { Router } = require("express");
const { consultingStripeCustomer, insertingStripeCustomer } = require("../controllers/stripe");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const router = Router();

//check stripe customer
// Con sesión desde 2026-10-19 (FedRAMP S0.1). La llama el login del dashboard
// justo DESPUÉS de guardar el token (Login.jsx, multipleCompanies/Modal.jsx).
router.post("/consulting-stripe", validateJWT, checkTokenVersion, consultingStripeCustomer)

//check item in warehouse 
// router.post('/warehouse-items', consultingItemInWarehouseTable)

//check table
// router.post('/items_information', consultingItemTable)

//check inventory current state by query
// router.post('/current-inventory', consultingInventoryCurrentState)

//check inventory current state by query
// router.post('/inventory_event/:id', consultingInventoryInEvent)

//track item history
// router.post('/tracking_item/:id', consultingInventoryTracking)

//insert new stripe customer
router.post('/new_stripe', insertingStripeCustomer)

//insert new item
// router.patch('/edit-item', updateItemInTable)

//delete item
// router.delete('/:id', deleteItem)


module.exports = router;