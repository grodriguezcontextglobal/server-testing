/**
 * Auth Route
 * host + /api/auth
 */

const { Router } = require("express");
const router = Router();
const { check } = require("express-validator");
const {
  newUser,
  getUser,
  checkUser,
  editUser,
  showAllUsers,
  lookupUsers,
  getListOfUsers,
  getAllConsumersBasedOnAllEventsPerCompany,
} = require("../controller/auth");
const validateFields = require("../middlewares/validate-field");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { optionalJWT } = require("../middlewares/optionalJWT");
const { contractLinkGate } = require("../middlewares/contractLinkAuth");
const {
  requireSessionFromDashboard,
  publicInvitationRateLimit,
} = require("../middlewares/attendanceLinkAuth");
const { requestConsumerLoginLink, redeemConsumerSession } = require("../controller/consumerSession");
const { requireConsumerOrigin } = require("../helpers/consumerToken");

// Acceso de un consumidor existente a la app del consumidor por enlace de
// correo (token de consumidor, fase A, 2026-10-21). Públicas a propósito: el
// consumidor no tiene contraseña; la prueba es el buzón. Ver
// controller/consumerSession.js.
// Solo desde la app del consumidor (CONSUMER_ORIGINS): 403 desde otro origen.
router.post("/consumer-login-link", requireConsumerOrigin, publicInvitationRateLimit, requestConsumerLoginLink);
router.post("/consumer-session", requireConsumerOrigin, publicInvitationRateLimit, redeemConsumerSession);

// Estas cuatro también las llama gente sin sesión (app.devitrak.net):
// optionalJWT nunca rechaza. Sin sesión de staff el controller solo permite
// buscar por email exacto. Desde el dashboard (admin.devitrak.net) exigen
// sesión, salvo POST /user-query (página pública /attendance-confirmation).
//render all users
router.get("/users", optionalJWT, showAllUsers)

//render user information by queries
router.post("/user-query", optionalJWT, requireSessionFromDashboard, lookupUsers)

//render user information by queries
router.post("/users", optionalJWT, showAllUsers)

//get list of user based on params and also cached result
router.get('/user-query', optionalJWT, getListOfUsers)

//create new user
router.post(
  "/new",
  [
    //middelwares para validar
    check("name", "Name is mandatory").not().isEmpty(),
    check("lastName", "Last name is mandatory").not().isEmpty(),
    check("email", "Email is mandatory").isEmail(),
    // check("phoneNumber", "Phone number is mandatory").not().isEmpty(),
    validateFields,
  ],
  // App del consumidor: sin token. Dashboard: con sesión (ver attendanceLinkAuth).
  optionalJWT,
  requireSessionFromDashboard,
  newUser
);

//edit user
router.patch("/:id", optionalJWT, requireSessionFromDashboard, editUser);

//retrieve consumer information
// También la llama la app del consumidor sin token. Desde el dashboard sin
// sesión es /display-contracts: ahí se exige el token del enlace del correo.
router.get(
  "/:id",
  optionalJWT,
  contractLinkGate({
    subject: (req) => ({ consumer_member_id: req.params.id }),
    sharedWithConsumerApp: true,
  }),
  getUser
);

//check existing user
router.post("/",check("email", "Email is mandatory").isEmail(), checkUser);

//get all consumers based on all events per company
router.get("/all-consumers-based-on-all-events-per-company/:companyID", validateJWT, checkTokenVersion, getAllConsumersBasedOnAllEventsPerCompany);

module.exports = router;
