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

//render all users
router.get("/users", showAllUsers)

//render user information by queries
router.post("/user-query", showAllUsers)

//render user information by queries
router.post("/users", showAllUsers)

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

//edit user
router.patch("/:id", editUser);

//retreive consumer information
router.get("/:id", getUser);

//check existing user
router.post("/",check("email", "Email is mandatory").isEmail(), checkUser); 

module.exports = router;
