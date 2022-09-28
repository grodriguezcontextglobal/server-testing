/**
 * Auth Route
 * host + /api/stripe
 */

const { Router } = require("express");
const router = Router();
const {
  stripePaymentIntent,
  listAllPaymentIntents,
  stripePaymentIntentUpdate,
  saveStripeTransaction,
} = require("../controller/stripe");
const { validateJWT } = require("../middlewares/validate-jwt");

//validation
// router.use(validateJWT);

router.post("/create-payment-intent", stripePaymentIntent);

router.get("/payment-intents", listAllPaymentIntents);

router.post("/payment-intents/:id", stripePaymentIntentUpdate);

router.post("/stripe-transaction",validateJWT,  saveStripeTransaction);

module.exports = router;
