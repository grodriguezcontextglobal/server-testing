const { Router } = require("express");
const { check } = require("express-validator");
const { isAcceptablePassword, passwordPolicyMessage } = require("../helpers/passwordPolicy");
const router = Router();

const validateFields = require("../middlewares/validate-field");
const {
  registerNewUserAndCompany,
  registerExistingUserNewCompany,
  acceptInvitation,
} = require("../controller/registration");

// POST /api/registration/new
// Crea usuario + empresa desde cero. Sin autenticación.
router.post(
  "/new",
  [
    check("user.name", "user.name es requerido").not().isEmpty(),
    check("user.lastName", "user.lastName es requerido").not().isEmpty(),
    check("user.email", "user.email debe ser un email válido").isEmail(),
    check("user.password", passwordPolicyMessage).custom(isAcceptablePassword),
    check("company.company_name", "company.company_name es requerido").not().isEmpty(),
    check("company.website", "company.website es requerido").not().isEmpty(),
    validateFields,
  ],
  registerNewUserAndCompany
);

// POST /api/registration/add-company
// Agrega una nueva empresa a un usuario existente identificado por user.userId.
router.post(
  "/add-company",
  [
    check("user.userId", "user.userId es requerido").not().isEmpty(),
    check("company.company_name", "company.company_name es requerido").not().isEmpty(),
    check("company.website", "company.website es requerido").not().isEmpty(),
    validateFields,
  ],
  registerExistingUserNewCompany
);

// POST /api/registration/accept-invitation
// Acepta una invitación. Crea o reutiliza el usuario e inserta en company_staff.
// Sin sesión: la prueba es `invitationToken`, el token firmado del enlace del
// correo. Email y compañía salen de él (ver acceptInvitation).
router.post("/accept-invitation", acceptInvitation);

module.exports = router;
