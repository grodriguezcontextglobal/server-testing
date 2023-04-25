/**
 * Auth Route
 * host + /api/staff
 */

 const { Router } = require("express");
 const router = Router();
 const apicache = require("apicache")
 const {
   displayAllAdminUser,
 } = require("../controller/admin");

 const cache = apicache.middleware
 //display all admin users
 router.get("/admin-users", cache("2 minutes"), displayAllAdminUser);
 
 module.exports = router;