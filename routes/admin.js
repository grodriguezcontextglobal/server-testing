/**
 * Auth Route
 * host + /api/admin
 */

const { Router } = require("express");
const router = Router();
const { check } = require("express-validator");
const { isAcceptablePassword, passwordPolicyMessage } = require("../helpers/passwordPolicy");
const {
  renewToken,
  createAdminUser,
  loginUser,
  showAllUsers,
  editAdminUser,
  deleteAdminUser,
  updatePassword,
  verifyPassword,
  editOtherAdminUser,
  checkStatus,
  logoutUser,
  manuallyLogoutUser,
  generateMfaSecret,
  verifyMfaSetup,
  disableMfa,
  regenerateRecoveryCodes,
  resetUserMfa,
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
const { validateMfaEnrollment } = require("../middlewares/validateMfaEnrollment");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { optionalJWT } = require("../middlewares/optionalJWT");
const { authorizeMongoPermission } = require("../middlewares/authorizeMongoPermission");
const { requireSuperUser } = require("../middlewares/requireSuperUser");

// Cierra la sesión de TODO el staff de TODAS las compañías. Hasta el 2026-10-19
// bastaba con llamarla (optionalJWT). Ningún frontend la llama: solo super_user
// de plataforma (FedRAMP S0.1).
router.post("/invalidate-all-sessions", validateJWT, checkTokenVersion, requireSuperUser, invalidateAllSessions);
//protected route
router.get("/protected", validateJWT, checkTokenVersion, (req, res) => {
  res.json({ message: "This is a protected route", user: req.user });
});

// Staff activity log
router.post("/activity-logs", validateJWT, checkTokenVersion, registerStaffActivity);
router.get("/activity-logs", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "read"), getStaffActivityLogs);

//create admin user
router.post(
  "/new_admin_user", validateJWT, checkTokenVersion,
  [
    //middelwares para validar
    check("name", "Name must be provided").not().isEmpty(),
    check("email", "Email must be provided").isEmail(),
    // Política de alta/cambio (IA-5). El login de abajo sigue aceptando 6: las
    // contraseñas anteriores más cortas tienen que poder entrar.
    check("password", passwordPolicyMessage).custom(isAcceptablePassword),
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
router.post("/manually_logout", validateJWT, checkTokenVersion, manuallyLogoutUser);

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
// StripeTransaction.find(body): con un body vacío devolvía todos los pagos con su
// usuario, sin sesión. Ningún frontend la llama (FedRAMP S0.1, 2026-10-19).
router.post("/users", validateJWT, checkTokenVersion, showAllUsers);

//edit admin user
router.patch("/profile/:id", validateJWT, checkTokenVersion, editAdminUser);

//edit admin user
router.patch("/admin-user/:id", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "update"), editOtherAdminUser);

//delete admin suer
router.delete("/:id", validateJWT, checkTokenVersion, authorizeMongoPermission("staff", "delete"), deleteAdminUser);

//update password — sin token a propósito (reset sin sesión); exige el código
// MFA de la cuenta. Ver updatePassword.
router.patch("/update-password", updatePassword);

// Comprueba la contraseña del propio usuario en el servidor (antes el dashboard
// comparaba contra el hash en el navegador).
router.post("/verify-password", validateJWT, checkTokenVersion, verifyPassword);

//post receivers per user per transaction
// Con sesión (FedRAMP P1.1, 2026-10-21): el dashboard es el único que la llama,
// siempre con sesión; la misma de /api/receiver/receiver-assignation.
router.post("/receiver-assignation", validateJWT, checkTokenVersion, addReceiverToTransaction);

//check paymentIntent was used for receivers
// (movida arriba, por encima de GET /:id — ver el comentario allí)

//check user online status
router.get("/check-online-status/:email", validateJWT, checkTokenVersion, checkStatus);

// MFA Routes
// Aceptan el token de enrolamiento (x-mfa-setup-token) que da el login a una
// cuenta sin MFA, o un JWT de sesión.
router.post("/mfa/generate", validateMfaEnrollment, generateMfaSecret);
router.post("/mfa/verify", validateMfaEnrollment, verifyMfaSetup);
router.post("/mfa/disable", validateJWT, checkTokenVersion, disableMfa);
// Pérdida del dispositivo (FedRAMP A5): códigos nuevos (pide un código TOTP) y
// reset por un administrador para quien perdió también los códigos.
router.post("/mfa/recovery-codes", validateJWT, checkTokenVersion, regenerateRecoveryCodes);
router.post("/mfa/reset/:id", validateJWT, checkTokenVersion, resetUserMfa);

// Canonical action / target_model list for the report's filter dropdown. Static
// metadata, so it needs no staff:read — only a valid session.
router.get("/activity-logs/vocabulary", validateJWT, checkTokenVersion, getActivityVocabulary);

module.exports = router;
