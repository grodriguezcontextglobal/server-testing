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
const { optionalJWT } = require("../middlewares/optionalJWT");

 //display all admin users
router.get("/admin-users", displayAllAdminUser);

//display all admin by queries
router.post("/admin-users", displayAllAdminUser);

 router.patch("/edit-admin/:id", optionalJWT, editOtherAdminUser);
 
 //search stripe customer by parameters
 router.get('/consumers/search',searchCustomerByParameters)

 //search staff info from not token side
 router.post('/__staff-search',displayAllAdminUser)

 //router to search all staff information
 router.get('/__staff-search',displayAllAdminUser)

 module.exports = router;