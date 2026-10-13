/**
 * Auth Route
 * host + /api/staff
 */

 const { Router } = require("express");
 const router = Router();
 const {
   displayAllAdminUser, editOtherAdminUser, forceEndSession, PROFILE_SELF_FIELDS,
   searchStaffByEmail,
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

// Editar a OTRO exige staff:update. El dashboard también usa esta ruta para el
// propio perfil (p. ej. `{ online: false }` al cerrar sesión), y ahí un rol sin
// staff:update (inventory_manager, assistant...) recibía 403. Si el id es el del
// que llama y el body solo trae campos personales (PROFILE_SELF_FIELDS, los
// mismos que deja PATCH /api/admin/profile/:id), no hace falta el permiso.
// Cualquier otro campo (super_user, email, rol...) sigue pasando por staff:update.
const canUpdateStaff = authorizeMongoPermission("staff", "update");
const isSelfProfileEdit = (req) => {
  const keys = Object.keys(req.body || {});
  return (
    String(req.params.id) === String(req.uid) &&
    keys.length > 0 &&
    keys.every((k) => PROFILE_SELF_FIELDS.has(k))
  );
};
const selfOrStaffUpdate = (req, res, next) =>
  isSelfProfileEdit(req) ? next() : canUpdateStaff(req, res, next);
 router.patch("/edit-admin/:id", validateJWT, checkTokenVersion, selfOrStaffUpdate, editOtherAdminUser);
 
 //search stripe customer by parameters
 router.get('/consumers/search',searchCustomerByParameters)

 //search staff info from not token side
 // Anónima a propósito (alta, invitación, olvidé mi contraseña): exige un email
 // exacto y devuelve solo campos públicos. Ver searchStaffByEmail.
 router.post('/__staff-search', searchStaffByEmail)

 //router to search all staff information
 router.get('/__staff-search', searchStaffByEmail)

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