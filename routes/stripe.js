/**
 * Auth Route
 * host + /api/stripe
 */

 const { Router } = require("express");
 const router = Router();
//  const { check } = require("express-validator"); 
 const { paymentIntent } = require("../controller/stripe"); //import functions related to credit card info


 router.post('/create-payment-intent', paymentIntent)

 module.exports = router;
