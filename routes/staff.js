/**
 * Auth Route
 * host + /api/staff
 */

 const { Router } = require("express");
 const router = Router();
 const { check } = require("express-validator");
 
 const {
   displayAllAdminUser,
 } = require("../controller/admin");
 const validateFields = require("../middlewares/validate-field");
 const { validateJWT } = require("../middlewares/validate-jwt");
 
 //display all admin users
 router.get("/admin-users", displayAllAdminUser);
 
 module.exports = router;