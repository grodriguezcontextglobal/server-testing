/**
 * Auth Route
 * host + /api/stripe
 */

 const { Router } = require("express");
 const router = Router();
 const { stripePaymentIntent } = require("../controller/stripe"); 

 router.post('/create-payment-intent', stripePaymentIntent)

 module.exports = router;
