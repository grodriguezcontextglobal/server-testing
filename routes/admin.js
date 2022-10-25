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
} = require("../controller/admin");
const {
  addReceiverToTransaction,
  checkingReceiversAssigned,
} = require("../controller/receiver");
const validateFields = require("../middlewares/validate-field");
const { validateJWT } = require("../middlewares/validate-jwt");

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
    check("password", "Password must have 6 charaters or mor").isLength({
      min: 6,
    }),
    validateFields,
  ],
  loginUser
);

//renovar token
router.get("/renew", validateJWT, renewToken);

//show all users in admin page
router.get("/:id", showAllUsers);

//edit admin user
router.put("/profile/:id", validateJWT, editAdminUser);

//delete admin suer
router.delete("/:id", deleteAdminUser)

//post receivers per user per transaction
router.post("/receiver-assignation", addReceiverToTransaction);

//check paymentIntent was used for receivers
router.get("/receiver-assigned", checkingReceiversAssigned);

module.exports = router;
