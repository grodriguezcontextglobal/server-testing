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
} = require("../controller/auth");
const validateFields = require("../middlewares/validate-field");
// const { validateJWT } = require("../middlewares/validate-jwt");

//render all users
router.get("/users", showAllUsers)

//create new user
router.post(
  "/new",
  [
    //middelwares para validar
    check("name", "Name is mandatory").not().isEmpty(),
    check("lastName", "Last name is mandatory").not().isEmpty(),
    check("email", "Email is mandatory").isEmail(),
    check("phoneNumber", "Phone number is mandatory").not().isEmpty(),
    validateFields,
  ],
  newUser
);

//editar evento
router.put("/:id", editUser);

//obtener la info del usuario
router.get("/:id", getUser);

//check user existencia
router.post("/",check("email", "Email is mandatory").isEmail(), checkUser); 

module.exports = router;
