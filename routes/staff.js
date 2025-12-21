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

 const { validateJWT } = require("../middlewares/validate-jwt");

 //display all admin users
router.get("/admin-users", validateJWT, displayAllAdminUser);

//display all admin by queries
router.post("/admin-users", validateJWT, displayAllAdminUser);

 router.patch("/edit-admin/:id", validateJWT, editOtherAdminUser)
 
 //search stripe customer by parameters
 router.get('/consumers/search',searchCustomerByParameters)
 module.exports = router;