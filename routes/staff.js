/**
 * Auth Route
 * host + /api/staff
 */

 const { Router } = require("express");
 const router = Router();
 const {
   displayAllAdminUser, editOtherAdminUser, forceEndSession,
 } = require("../controller/admin");
const { searchCustomerByParameters } = require("../controller/stripe");
const { optionalJWT } = require("../middlewares/optionalJWT");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { authorizeMongoPermission } = require("../middlewares/authorizeMongoPermission");

 //display all admin users
router.get("/admin-users", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "read"), displayAllAdminUser);

//display all admin by queries
router.post("/admin-users", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "read"), displayAllAdminUser);

 router.patch("/edit-admin/:id", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "update"), editOtherAdminUser);
 
 //search stripe customer by parameters
 router.get('/consumers/search',searchCustomerByParameters)

 //search staff info from not token side
 router.post('/__staff-search',displayAllAdminUser)

 //router to search all staff information
 router.get('/__staff-search',displayAllAdminUser)

 // Route to handle user logout
router.post("/force-logout", forceEndSession);

 module.exports = router;