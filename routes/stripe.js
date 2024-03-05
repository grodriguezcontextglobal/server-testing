/**
 * Auth Route
 * host + /api/stripe
 */

const { Router } = require("express");
const router = Router();
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
  updateDefaultPaymentMethodInCustomer
} = require("../controller/stripe");
const { saveTransaction, saveTransactionAdmin, saveTransactionTemplateForNoRegularUser, getListOfAllSavedTransaction, removeDuplicateEntry } = require("../controller/transaction");


//create customer
router.post("/customer", stripeCustomer);

//create payment intent
router.post("/create-payment-intent", stripePaymentIntent);

//create payment intent from admin side
router.post("/create-payment-intent-customized", stripePaymentIntentCustomized);

//create payment intent for subscription
router.post(
  "/create-payment-intent-subscription",
  stripePaymentIntentSubscription
);

//create new company customer for subscriptions
router.post("/new-company-account", companyInformationAccountStripe)

//route to create subscription from tiers and make charges monthly/yearly
router.post("/create-subscriptions", creatingSubscription)

//update payment method in subscription
router.post("/payment-method/subscriptions/:id", updateDefaultPaymentMethodInSubscription)

//update payment method in customer
router.post("/payment_methods/:id/attach", updateDefaultPaymentMethodInCustomer)

//list all payment intent created
router.get("/payment-intents/search", searchStripeTransaction);

//search payment intent
router.get("/customers/search", searchCustomerId);

//list all customers created
router.get("/customers", listAllCustomers);

//search customer
router.get("/customers/search", searchCustomerId);

//retreive paymentIntent
router.get("/payment_intents/:id", retrievePaymentIntent);

//get list of stripe transactions saved
router.get("/stripe-transactions-saved-list", getListOfAllSavedStripeTransaction)

//get saved stripe transaction by query
router.post("/stripe-transactions-saved-list", getListOfAllSavedStripeTransaction)

//finding company stripe account 
router.get("/company-account-stripe/:companyName", stripeCompanyAccountFound)

//retrieve all invoices per subscription
router.get("/invoices", displayAllPaidInvoicesPerSubscription)

//update subscription for cancel at the end of period or 
router.post("/cancel/subscriptions/:id", updateCancelSubscription)

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction", saveStripeTransaction);

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction-admin", saveStripeTransactionAdmin);

//capture payment intent amount
router.post("/payment-intents/:id/capture", captureStripePaymentIntent);

//cancel payment intent amount
router.post("/payment-intents/:id/cancel", cancelStripePaymentIntent);

//save No regular user object {device, paymentIntentId, clientSecret} in database
router.post(
  "/stripe-transaction-no-regular-user",
  saveStripeTransactionTemplateForNoRegularUser
);

//create a refund
router.post("/refund", refundStripePaymentIntent);

//removing duplicate entries in database
router.delete("/remove-duplicate/:id", removeDuplicateEntries);

//!new route for transaction model fro new design
//*saving new transaction
router.post("/save-transaction", saveTransaction)

//*saving new transaction
router.post("/save-transaction-admin-dashboard", saveTransactionAdmin)

//*saving new transaction
router.post("/save-transaction-template-no-regular-user", saveTransactionTemplateForNoRegularUser)

//*saving new transaction
router.get("/transaction", getListOfAllSavedTransaction)

//*remove duplicate entry in transaction document
router.delete("/removing/:id", removeDuplicateEntry)

//search subscription information
router.get('/subscriptions/:id', searchSubscriptions)

//updating stored subscription
router.patch("/updating-subscription/:id", updateSubcriptionInCompanyAccount)

//cancel subscription
router.delete("/subscriptions/:id", cancelSubscriptionCompany)

module.exports = router;
