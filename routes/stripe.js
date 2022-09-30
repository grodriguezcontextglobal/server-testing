/**
 * Auth Route
 * host + /api/stripe
 */

const { Router } = require("express");
const router = Router();
const {
  stripePaymentIntent,
  listAllPaymentIntents,
  saveStripeTransaction,
  captureStripePaymentIntent,
  cancelStripePaymentIntent,
  stripeCustomer
} = require("../controller/stripe");
const { validateJWT } = require("../middlewares/validate-jwt");

//create customer
router.post("/customer", stripeCustomer)

//create payment intent
router.post("/create-payment-intent", stripePaymentIntent);

//list all payment intent created
router.get("/payment-intents", listAllPaymentIntents);

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction",validateJWT,  saveStripeTransaction);

//capture payment intent amount
router.post("/payment-intents/:id/capture", captureStripePaymentIntent)

//cancel payment intent amount
router.post("/payment-intents/:id/cancel", cancelStripePaymentIntent)

module.exports = router;
