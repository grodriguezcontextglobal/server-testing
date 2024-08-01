/**
 * Auth Route
 * host + /api/staff
 */

 const { Router } = require("express");
 const router = Router();
 const {
   displayAllAdminUser, editOtherAdminUser,
 } = require("../controller/admin");
const { searchCustomerByParameters } = require("../controller/stripe");

 //display all admin users
router.get("/admin-users", displayAllAdminUser);

//display all admin by queries
router.post("/admin-users", displayAllAdminUser);

 router.patch("/edit-admin/:id", editOtherAdminUser)
 
 //search stripe customer by parameters
 router.get('/consumers/search',searchCustomerByParameters)
 module.exports = router;