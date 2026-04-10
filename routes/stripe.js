/**
 * Auth Route
 * host + /api/stripe
 */

const { Router } = require("express");
const router = Router();
const { publicPaymentRateLimit } = require("../middlewares/publicPaymentRateLimit");
const { validatePublicPaymentPayload } = require("../middlewares/validatePublicPaymentPayload");
const { attachServerIdempotencyKey } = require("../middlewares/attachServerIdempotencyKey");
const { optionalJWT } = require("../middlewares/optionalJWT");
const { validateJWT } = require("../middlewares/validate-jwt");
const { authorizeAdminRoles } = require("../middlewares/authorizeAdminRoles");
const {
  validatePaymentIntentIdParam,
  validateRefundPayload,
} = require("../middlewares/validateStripeRoutePayload");
const { idempotencyMutationCache } = require("../middlewares/idempotencyMutationCache");

const internalStripeGuard = [validateJWT, authorizeAdminRoles()];
const {
  stripePaymentIntent,
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
  stripePaymentIntentSubscription,
  getListOfAllSavedStripeTransaction,
  searchStripeTransaction,
  companyInformationAccountStripe,
  stripeCompanyAccountFound,
  creatingSubscription,
  searchSubscriptions,
  updateSubcriptionInCompanyAccount,
  cancelSubscriptionCompany,
  displayAllPaidInvoicesPerSubscription,
  updateCancelSubscription,
  updateDefaultPaymentMethodInSubscription,
  updateDefaultPaymentMethodInCustomer,
  findSubscriptionIdBySetUpId,
  createSubscriptionNoTrialPeriod,
  updatePaymentMethodFromAdminDashboard,
  stripeAccountCreate,
  stripeAccountSession,
  stripeAccountLink,
  partialRefundStripePaymentIntent,
} = require("../controller/stripe");
const {
  saveTransaction,
  saveTransactionAdmin,
  saveTransactionTemplateForNoRegularUser,
  getListOfAllSavedTransaction,
  removeDuplicateEntry,
} = require("../controller/transaction");

//create customer
router.post("/customer", stripeCustomer);

//create account
router.post("/accounts", optionalJWT, stripeAccountCreate);

//router account link
router.post("/account_link", optionalJWT, stripeAccountLink);

//create account session
router.post("/account_sessions", optionalJWT, stripeAccountSession);

//create payment intent
router.post(
  "/create-payment-intent",
  optionalJWT,
  publicPaymentRateLimit,
  validatePublicPaymentPayload,
  attachServerIdempotencyKey,
  stripePaymentIntent
);

//create payment intent from admin side
router.post("/create-payment-intent-customized", optionalJWT, stripePaymentIntentCustomized);

//create payment intent for subscription
router.post(
  "/create-payment-intent-subscription",
  optionalJWT,
  stripePaymentIntentSubscription
);

//create new company customer for subscriptions
router.post("/new-company-account", companyInformationAccountStripe);

//route to create subscription from tiers and make charges monthly/yearly
router.post("/create-subscriptions", optionalJWT, creatingSubscription);

//*create subscription no trail period from tiers and make charges monthly/yearly
router.post("/create-subscriptions_no_trial", optionalJWT, createSubscriptionNoTrialPeriod);

//update payment method in subscription
router.post(
  "/payment-method/subscriptions/:id",
  ...internalStripeGuard,
  updateDefaultPaymentMethodInSubscription
);

//update payment method in customer
router.post(
  "/payment_methods/:id/attach",
  ...internalStripeGuard,
  updateDefaultPaymentMethodInCustomer
);

//update payment method in customer
router.post(
  "/payment_intents/:id/update-payment-method",
  ...internalStripeGuard,
  updatePaymentMethodFromAdminDashboard
);

//list all payment intent created
router.get("/payment-intents/search", ...internalStripeGuard, searchStripeTransaction);

//search subscription by setup id
router.post("/setup-search", ...internalStripeGuard, findSubscriptionIdBySetUpId);

//list all customers created
router.get("/customers", ...internalStripeGuard, listAllCustomers);

//list all customers created
router.post("/customers", optionalJWT, listAllCustomers);

//search customer
router.get("/customers/search", ...internalStripeGuard, searchCustomerId);

//retrieve paymentIntent
router.get("/payment_intents/:id", optionalJWT, retrievePaymentIntent);

//get list of stripe transactions saved
router.get(
  "/stripe-transactions-saved-list",
  ...internalStripeGuard,
  getListOfAllSavedStripeTransaction
);

//get saved stripe transaction by query
router.post(
  "/stripe-transactions-saved-list",
  ...internalStripeGuard,
  getListOfAllSavedStripeTransaction
);

//finding company stripe account
router.post("/company-account-stripe/", optionalJWT, stripeCompanyAccountFound);

//retrieve all invoices per subscription
router.get("/invoices", ...internalStripeGuard, displayAllPaidInvoicesPerSubscription);

//retrieve all invoices per subscription
router.post("/invoices", ...internalStripeGuard, displayAllPaidInvoicesPerSubscription);

//update subscription for cancel at the end of period or
router.post("/cancel/subscriptions/:id", ...internalStripeGuard, updateCancelSubscription);

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction", optionalJWT, saveStripeTransaction);

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction-admin", ...internalStripeGuard, saveStripeTransactionAdmin);

//capture payment intent amount
router.post(
  "/payment-intents/:id/capture",
  publicPaymentRateLimit,
  validatePaymentIntentIdParam,
  idempotencyMutationCache,
  captureStripePaymentIntent
);

//cancel payment intent amount
router.post(
  "/payment-intents/:id/cancel",
  publicPaymentRateLimit,
  validatePaymentIntentIdParam,
  idempotencyMutationCache,
  cancelStripePaymentIntent
);

//internal/admin aliases for the same operations
router.post(
  "/internal/payment-intents/:id/capture",
  ...internalStripeGuard,
  validatePaymentIntentIdParam,
  idempotencyMutationCache,
  captureStripePaymentIntent
);

router.post(
  "/internal/payment-intents/:id/cancel",
  ...internalStripeGuard,
  validatePaymentIntentIdParam,
  idempotencyMutationCache,
  cancelStripePaymentIntent
);

//save No regular user object {device, paymentIntentId, clientSecret} in database
router.post(
  "/stripe-transaction-no-regular-user",
  saveStripeTransactionTemplateForNoRegularUser
);

//create a refund
router.post(
  "/refund",
  publicPaymentRateLimit,
  validateRefundPayload,
  idempotencyMutationCache,
  refundStripePaymentIntent
);

//create a partial refund
router.post(
  "/partial-refund",
  publicPaymentRateLimit,
  validateRefundPayload,
  idempotencyMutationCache,
  partialRefundStripePaymentIntent
);

router.post(
  "/internal/refund",
  ...internalStripeGuard,
  validateRefundPayload,
  idempotencyMutationCache,
  refundStripePaymentIntent
);

router.post(
  "/internal/partial-refund",
  ...internalStripeGuard,
  validateRefundPayload,
  idempotencyMutationCache,
  partialRefundStripePaymentIntent
);
//removing duplicate entries in database
router.delete("/remove-duplicate/:id", ...internalStripeGuard, removeDuplicateEntries);

//!new route for transaction model fro new design
//*saving new transaction
router.post("/save-transaction", saveTransaction);

//*saving new transaction
router.post("/save-transaction-admin-dashboard", ...internalStripeGuard, saveTransactionAdmin);

//*saving new transaction
router.post(
  "/save-transaction-template-no-regular-user",
  saveTransactionTemplateForNoRegularUser
);

//*saving new transaction
router.get("/transaction", ...internalStripeGuard, getListOfAllSavedTransaction);

//*remove duplicate entry in transaction document
router.delete("/removing/:id", ...internalStripeGuard, removeDuplicateEntry);

//search subscription information
router.get("/subscriptions/:id", ...internalStripeGuard, searchSubscriptions);

//updating stored subscription
router.patch("/updating-subscription/:id", ...internalStripeGuard, updateSubcriptionInCompanyAccount);

//cancel subscription
router.delete("/subscriptions/:id", ...internalStripeGuard, cancelSubscriptionCompany);

module.exports = router;
