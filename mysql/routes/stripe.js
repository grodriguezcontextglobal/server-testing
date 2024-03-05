
/**
 * Auth Route
 * host + /api/db_stripe
 */

const { Router } = require("express");
const { consultingStripeCustomer, insertingStripeCustomer } = require("../controllers/stripe");
const router = Router();

//check stripe customer
router.post("/consulting-stripe", consultingStripeCustomer)

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