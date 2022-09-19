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
   loginUser
 } = require("../controller/admin");
 const validateFields = require("../middlewares/validate-field");
 const { validateJWT } = require("../middlewares/validate-jwt");
 
 
 //create admin user
 router.post(
   "/new_admin_user", 
 [ //middelwares para validar 
   check('name', 'el nombre es obligatorio').not().isEmpty(),
   check('email', 'el email es obligatorio').isEmail(),
   check('password', 'el password es debe ser superior a 6 caracteres').isLength({ min: 6}),
   validateFields
 ], 
   createAdminUser);
 
   //login user
 router.post("/login", 
 [ //middelwares para validar 
   check('email', 'el email es obligatorio').isEmail(),
   check('password', 'el password es debe ser superior a 6 caracteres').isLength({ min: 6}),
   validateFields
 ], 
 loginUser);
 
 //renovar token
 router.get("/renew", validateJWT, renewToken);
 
 
 module.exports = router;
 