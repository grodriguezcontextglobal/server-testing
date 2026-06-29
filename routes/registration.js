const { Router } = require("express");
const { check } = require("express-validator");
const router = Router();

const validateFields = require("../middlewares/validate-field");
const {
  registerNewUserAndCompany,
  registerExistingUserNewCompany,
} = require("../controller/registration");

// POST /api/registration/new
// Crea usuario + empresa desde cero. Sin autenticación.
router.post(
  "/new",
  [
    check("user.name", "user.name es requerido").not().isEmpty(),
    check("user.lastName", "user.lastName es requerido").not().isEmpty(),
    check("user.email", "user.email debe ser un email válido").isEmail(),
    check("user.password", "user.password debe tener al menos 6 caracteres").isLength({ min: 6 }),
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

module.exports = router;
