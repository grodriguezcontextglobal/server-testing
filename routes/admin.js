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
} = require("../controller/admin");
const {
  addReceiverToTransaction,
  checkingReceiversAssigned,
} = require("../controller/receiver");
const validateFields = require("../middlewares/validate-field");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { optionalJWT } = require("../middlewares/optionalJWT");

//protected route
router.get("/protected", validateJWT, checkTokenVersion, (req, res) => {
  res.json({ message: "This is a protected route", user: req.user });
});

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
router.get("/:id", showAllUsers);

//show all users in admin page
router.post("/users", showAllUsers);

//edit admin user
router.patch("/profile/:id", validateJWT, editAdminUser);

//edit admin user
router.patch("/admin-user/:id", optionalJWT, editOtherAdminUser);

//delete admin suer
router.delete("/:id", validateJWT, deleteAdminUser);

//update password
router.patch("/update-password", updatePassword);

//post receivers per user per transaction
router.post("/receiver-assignation", addReceiverToTransaction);

//check paymentIntent was used for receivers
router.get("/receiver-assigned", checkingReceiversAssigned);

//check user online status
router.get("/check-online-status/:email", checkStatus);

// MFA Routes
router.post("/mfa/generate", validateJWT, generateMfaSecret);
router.post("/mfa/verify", validateJWT, verifyMfaSetup);
router.post("/mfa/disable", validateJWT, disableMfa);

module.exports = router;
