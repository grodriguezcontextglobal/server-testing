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
// Token opcional: desde el login no hay token y se borra la sesión del email
// (volver a entrar sigue exigiendo contraseña + MFA). Si llega token, se valida
// entero (firma + tokenVersion): uno inválido es 401, no "sin token"; con token
// se puede cerrar la sesión de otro según los permisos de forceEndSession.
const tokenIfPresent = (req, res, next) =>
  req.header("x-token")
    ? validateJWT(req, res, () => checkTokenVersion(req, res, next))
    : next();
router.post("/force-logout", tokenIfPresent, forceEndSession);

 module.exports = router;