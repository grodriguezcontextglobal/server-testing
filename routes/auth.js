/**
 * Auth Route
 * host + /api/auth
 */

const { Router } = require("express");
const router = Router();
const { check } = require("express-validator");

const { newUser, login, editUser, renewToken } = require("../controller/auth");
const validateFields = require("../middlewares/validate-field");
const { validateJWT } = require("../middlewares/validate-jwt");

router.post(
  "/new",
  [
    //middelwares para validar
    check("groupName", "Group name is mandatory").not().isEmpty(),
    check("name","Name is mandatory").not().isEmpty(),
    check("lastName", "Last name is mandatory").not().isEmpty(),
    check("email", "Email is mandatory").isEmail(),
    check("phoneNumber", "Phone number is mandatory").not().isEmpty(),
    // check(
    //   "password",
    //   "el password es debe ser superior a 6 caracteres"
    // ).isLength({ min: 6 }),
    validateFields,
  ],
  newUser
);

//editar evento
router.put('/:id', editUser)


router.get("/renew", validateJWT, renewToken);

module.exports = router;
