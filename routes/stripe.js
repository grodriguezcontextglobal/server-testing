/**
 * Auth Route
 * host + /api/stripe
 */

 const { Router } = require("express");
 const router = Router();
 const { stripePaymentIntent, listAllPaymentIntents, stripeSetupIntent } = require("../controller/stripe"); 

 router.post('/create-payment-intent', stripePaymentIntent)

 router.get('/payment_intents', listAllPaymentIntents
 )
 router.post('/setup_intent', stripeSetupIntent )

 module.exports = router;
