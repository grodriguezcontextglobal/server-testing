
/**
 * Auth Route
 * host + /api/db_staff
 */

const { Router } = require("express");
const { insertingStaffMember, consultingStaffMemberInformation } = require("../controllers/staff");
const router = Router();

//check item info
router.post("/consulting-member", consultingStaffMemberInformation)

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

//insert new item
router.post('/new_member', insertingStaffMember)

//insert new item
// router.patch('/edit-item', updateItemInTable)

//delete item
// router.delete('/:id', deleteItem)


module.exports = router;