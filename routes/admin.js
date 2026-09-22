/**
 * Auth Route
 * host + /api/admin
 */

const { Router } = require("express");
const router = Router();
const { check } = require("express-validator");
const {
  renewToken,
  createAdminUser,
  loginUser,
  showAllUsers,
  editAdminUser,
  deleteAdminUser,
  updatePassword,
  editOtherAdminUser,
  checkStatus,
  logoutUser,
  manuallyLogoutUser,
  generateMfaSecret,
  verifyMfaSetup,
  disableMfa,
  invalidateAllSessions,
} = require("../controller/admin");

const {
  addReceiverToTransaction,
  checkingReceiversAssigned,
} = require("../controller/receiver");
const {
  getStaffActivityLogs,
  registerStaffActivity,
  getActivityVocabulary,
} = require("../controller/staffActivityLog");
const validateFields = require("../middlewares/validate-field");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { optionalJWT } = require("../middlewares/optionalJWT");
const { authorizeMongoPermission } = require("../middlewares/authorizeMongoPermission");

router.post("/invalidate-all-sessions", optionalJWT, invalidateAllSessions);
//protected route
router.get("/protected", validateJWT, checkTokenVersion, (req, res) => {
  res.json({ message: "This is a protected route", user: req.user });
});

// Staff activity log
router.post("/activity-logs", validateJWT, checkTokenVersion, registerStaffActivity);
router.get("/activity-logs", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "read"), getStaffActivityLogs);

//create admin user
router.post(
  "/new_admin_user",
  [
    //middelwares para validar
    check("name", "Name must be provided").not().isEmpty(),
    check("email", "Email must be provided").isEmail(),
    check("password", "Password must have 6 charaters or more").isLength({
      min: 6,
    }),
    validateFields,
  ],
  createAdminUser
);

//login user
router.post(
  "/login",
  [
    //middelwares para validar
    check("email", "Email must be provided").isEmail(),
    check("password", "Password must have 6 charaters or more").isLength({
      min: 6,
    }),
    validateFields,
  ],
  loginUser
);

//logout user
router.post("/logout", logoutUser);

//router for manually log out user
router.post("/manually_logout", manuallyLogoutUser);

//renovar token
router.get("/renew", validateJWT, renewToken);

//show all users in admin page
// Va ANTES del `GET /:id` de abajo: ese parámetro sin acotar captura cualquier
// ruta literal registrada después, y tenía sombreada a esta desde su línea 112.
// Lo que devolvía `GET /api/admin/receiver-assigned` no eran los receivers
// asignados sino la LISTA DE USUARIOS de `showAllUsers`.
//
// Se revive con `validateJWT`: iba sin token, y dejarla anónima ahora sería
// abrir un endpoint nuevo. Nadie puede depender de su respuesta actual, porque
// su respuesta actual es la de otra ruta.
router.get("/receiver-assigned", validateJWT, checkingReceiversAssigned);

router.get("/:id", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "read"), showAllUsers);

//show all users in admin page
router.post("/users", showAllUsers);

//edit admin user
router.patch("/profile/:id", validateJWT, editAdminUser);

//edit admin user
router.patch("/admin-user/:id", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "update"), editOtherAdminUser);

//delete admin suer
router.delete("/:id", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "delete"), deleteAdminUser);

//update password
router.patch("/update-password", updatePassword);

//post receivers per user per transaction
router.post("/receiver-assignation", addReceiverToTransaction);

//check paymentIntent was used for receivers
// (movida arriba, por encima de GET /:id — ver el comentario allí)

//check user online status
router.get("/check-online-status/:email", checkStatus);

// MFA Routes
router.post("/mfa/generate", validateJWT, generateMfaSecret);
router.post("/mfa/verify", validateJWT, verifyMfaSetup);
router.post("/mfa/disable", validateJWT, disableMfa);

// Canonical action / target_model list for the report's filter dropdown. Static
// metadata, so it needs no staff:read — only a valid session.
router.get("/activity-logs/vocabulary", validateJWT, checkTokenVersion, getActivityVocabulary);

module.exports = router;
