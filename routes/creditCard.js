/**
 * Auth Route
 * host + /api/payment
 */

 const { Router } = require("express");
 const router = Router();
 const { check } = require("express-validator");
 
 const { newCreditCard, editCreditCard, getAllCreditCards } = require("../controller/creditCard"); //import functions related to credit card info
 const validateFields = require("../middlewares/validate-field");
 const { validateJWT } = require("../middlewares/validate-jwt");

 //validation
 router.use( validateJWT )
 
 router.post(
   "/new_credit_card",
   [
     //middelwares para validar
     check("cardName", "Card name is mandatory").not().isEmpty(),
     check("cardNumber","Card number is mandatory").not().isEmpty().isNumeric(),
     check("mm", "Experation month is mandatory").not().isEmpty().isNumeric(),
     check("yy", "Experation year is mandatory").not().isEmpty().isNumeric(),
     check("cvv", "Cvv is mandatory").not().isEmpty().isNumeric(),
     check("zip", "Zip code must be provided").notEmpty(),
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
 router.put('/:id',[
  //middelwares para validar
  check("cardName", "Card name is mandatory").not().isEmpty(),
  check("cardNumber","Card number is mandatory").not().isEmpty().isNumeric(),
  check("mm", "Experation month is mandatory").not().isEmpty().isNumeric(),
  check("yy", "Experation year is mandatory").not().isEmpty().isNumeric(),
  check("cvv", "Cvv is mandatory").not().isEmpty().isNumeric(),
  check("zip", "Zip code must be provided").notEmpty(),
  check("country", "Country must be provided").not().isEmpty(),
 ], editCreditCard)
 
 router.get("/", getAllCreditCards)
 
//  router.get("/renew", validateJWT, renewToken);
 
 module.exports = router;
 