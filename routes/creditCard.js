/**
 * Auth Route
 * host + /api/payment
 */

 const { Router } = require("express");
 const router = Router();
 const { check } = require("express-validator");
 
 const { newCreditCard, editCreditCard } = require("../controller/creditCard"); //import functions related to credit card info
 const validateFields = require("../middlewares/validate-field");
 const { validateJWT } = require("../middlewares/validate-jwt");
 
 router.post(
   "/new_credit_card",
   [
     //middelwares para validar
     check("cardName", "Card name is mandatory").not().isEmpty(),
     check("cardNumber","Card number is mandatory").not().isEmpty().isNumeric(),
     check("mm", "Experation month is mandatory").not().isEmpty().isNumeric(),
     check("yy", "Experation year is mandatory").not().isEmpty().isNumeric(),
     check("cvv", "Cvv is mandatory").not().isEmpty().isNumeric(),
     check("zip", "Zip code must be provided").notEmpty().isNumeric(),
     check("country", "Country must be provided").not().isEmpty(),
     // check(
     //   "password",
     //   "el password es debe ser superior a 6 caracteres"
     // ).isLength({ min: 6 }),
     validateFields,
   ],
   newCreditCard //function imported from payment controller
 );
 
 //editar evento
 router.put('/:id', editCreditCard)
 
 
//  router.get("/renew", validateJWT, renewToken);
 
 module.exports = router;
 