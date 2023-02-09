/**
 * Auth Route
 * host + /api/stripe
 */

const { Router } = require("express");
const router = Router();
const {
  stripePaymentIntent,
  listAllPaymentIntents,
  listAllCustomers,
  saveStripeTransaction,
  captureStripePaymentIntent,
  cancelStripePaymentIntent,
  stripeCustomer,
  saveStripeTransactionTemplateForNoRegularUser,
  removeDuplicateEntries,
  saveStripeTransactionAdmin,
  searchCustomerId,
  retrievePaymentIntent,
  refundStripePaymentIntent,
  stripePaymentIntentCustomized,
} = require("../controller/stripe");
const { validateJWT } = require("../middlewares/validate-jwt");

//create customer
router.post("/customer", stripeCustomer)

//create payment intent
router.post("/create-payment-intent", stripePaymentIntent);

//create payment intent
router.post("/create-payment-intent-customized", stripePaymentIntentCustomized);

//list all payment intent created
router.get("/payment-intents", listAllPaymentIntents);

//list all customers created
router.get("/customers", listAllCustomers)

//search customer
router.get("/customers/search", searchCustomerId)

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction",validateJWT,  saveStripeTransaction);

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction-admin",  saveStripeTransactionAdmin);

//capture payment intent amount
router.post("/payment-intents/:id/capture", captureStripePaymentIntent)

//cancel payment intent amount
router.post("/payment-intents/:id/cancel", cancelStripePaymentIntent)

//save No regular user object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction-no-regular-user", saveStripeTransactionTemplateForNoRegularUser);

//removing duplicate entries in database
router.delete("/remove-duplicate/:id", removeDuplicateEntries)

//retreive paymentIntent
router.get("/payment_intents/:id", retrievePaymentIntent)

//create a refund
router.post("/refund", refundStripePaymentIntent)

module.exports = router;
