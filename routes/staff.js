/**
 * Auth Route
 * host + /api/staff
 */

 const { Router } = require("express");
 const router = Router();
 
 const {
   displayAllAdminUser,
 } = require("../controller/admin");

 //display all admin users
 router.get("/admin-users", displayAllAdminUser);
 
 module.exports = router;