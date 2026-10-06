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
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { authorizeMongoPermission } = require("../middlewares/authorizeMongoPermission");
const {
  validatePaymentIntentIdParam,
  validateRefundPayload,
} = require("../middlewares/validateStripeRoutePayload");
const { idempotencyMutationCache } = require("../middlewares/idempotencyMutationCache");

// Mover dinero ya cobrado (reembolsar, capturar o liberar un depósito) exige
// sesión. Estas cuatro rutas eran públicas por "compatibilidad", y mientras el
// validador de refund estaba roto (marzo → 2026-10-06) eso no se notaba; con el
// arreglo desplegado, cualquiera con un pi_ —que viaja en los correos a
// consumidores— podía reembolsarlo.
//
// `transaction:update` y no `billing:update` (lo que piden las /internal/): el
// event_manager cobra y devuelve depósitos en los eventos y tiene
// `transaction:*`, pero no `billing:*`. El dashboard ya manda token y
// x-company-id a /api/stripe, así que no cambia nada para él.
//
// Falta (PLAN_stripe_2026-10-06.md, Fase 0.1): comprobar que el pago es de la
// compañía de quien lo mueve. Con una sola cuenta de Stripe, el permiso solo
// dice que puede mover dinero, no de quién.
const canMoveCollectedMoney = [
  validateJWT,
  checkTokenVersion,
  authorizeMongoPermission("transaction", "update"),
];
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
  stripeCompanyAccountUpdate,
} = require("../controller/stripe");
const {
  saveTransaction,
  saveTransactionAdmin,
  saveTransactionTemplateForNoRegularUser,
  getListOfAllSavedTransaction,
  removeDuplicateEntry,
} = require("../controller/transaction");

//create customer
// TODA ruta de este router pasa por la misma cadena, y es deliberado.
//
// Hasta hoy el limite y la idempotencia se ponian ruta a ruta, y el recuento
// hablaba solo: de 46 rutas, 6 tenian limitador y 9 idempotencia. Una
// convencion que hay que acordarse de repetir en cada linea nueva se acaba
// olvidando; una que vive en el router, no. Anadir una ruta aqui ya no puede
// nacer desprotegida.
//
// EL ORDEN IMPORTA: optionalJWT va primero porque el limitador lee
// req.authContext.lane para decidir el presupuesto (120 por ventana para una
// peticion con sesion frente a 30 sin ella). Al reves, todo el trafico
// autenticado cobraria el limite del carril publico.
router.use(optionalJWT);
router.use(publicPaymentRateLimit);

// La idempotencia SOLO en las mutaciones, y esto no es un detalle: el cache
// guarda la respuesta 10 minutos y la devuelve tal cual a la siguiente
// peticion con la misma clave. En un GET eso serian lecturas rancias -- una
// lista de transacciones congelada durante diez minutos despues de cobrar --,
// que es justo lo contrario de lo que espera quien consulta.
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const idempotencyOnMutations = (req, res, next) =>
  MUTATING.has(req.method) ? idempotencyMutationCache(req, res, next) : next();
router.use(idempotencyOnMutations);

router.post("/customer", stripeCustomer);

//create account
router.post("/accounts", stripeAccountCreate);

//router account link
router.post("/account_link", stripeAccountLink);

//create account session
router.post("/account_sessions", stripeAccountSession);

//create payment intent
router.post(
  "/create-payment-intent",
  validatePublicPaymentPayload,
  attachServerIdempotencyKey,
  stripePaymentIntent
);

//create payment intent from admin side
router.post("/create-payment-intent-customized", stripePaymentIntentCustomized);

//create payment intent for subscription
router.post(
  "/create-payment-intent-subscription",
  stripePaymentIntentSubscription
);

//create new company customer for subscriptions
router.post("/new-company-account", companyInformationAccountStripe);

//route to create subscription from tiers and make charges monthly/yearly
router.post("/create-subscriptions", creatingSubscription);

//*create subscription no trail period from tiers and make charges monthly/yearly
router.post("/create-subscriptions_no_trial", createSubscriptionNoTrialPeriod);

//update payment method in subscription
router.post(
  "/payment-method/subscriptions/:id",
  updateDefaultPaymentMethodInSubscription
);

//update payment method in customer
router.post(
  "/payment_methods/:id/attach",
  updateDefaultPaymentMethodInCustomer
);

//update payment method in customer
router.post(
  "/payment_intents/:id/update-payment-method",
  updatePaymentMethodFromAdminDashboard
);

//list all payment intent created
router.get("/payment-intents/search", searchStripeTransaction);

//search subscription by setup id
router.post("/setup-search", findSubscriptionIdBySetUpId);

//list all customers created
router.get("/customers", validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "read"), listAllCustomers);

//list all customers created
router.post("/customers", validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "read"), listAllCustomers);

//search customer
router.get("/customers/search", validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "read"), searchCustomerId);

//retrieve paymentIntent
router.get("/payment_intents/:id", retrievePaymentIntent);

//get list of stripe transactions saved
router.get(
  "/stripe-transactions-saved-list",
  getListOfAllSavedStripeTransaction
);

//get saved stripe transaction by query
router.post(
  "/stripe-transactions-saved-list",
  getListOfAllSavedStripeTransaction
);

//finding company stripe account
router.post("/company-account-stripe/", stripeCompanyAccountFound);

//retrieve all invoices per subscription
router.get("/invoices", displayAllPaidInvoicesPerSubscription);

//retrieve all invoices per subscription
router.post("/invoices", displayAllPaidInvoicesPerSubscription);

//update subscription for cancel at the end of period or
router.post("/cancel/subscriptions/:id", updateCancelSubscription);

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction", saveStripeTransaction);

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction-admin", validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"), saveStripeTransactionAdmin);

//capture payment intent amount
router.post(
  "/payment-intents/:id/capture",
  canMoveCollectedMoney,
  validatePaymentIntentIdParam,
  captureStripePaymentIntent
);

//cancel payment intent amount
router.post(
  "/payment-intents/:id/cancel",
  canMoveCollectedMoney,
  validatePaymentIntentIdParam,
  cancelStripePaymentIntent
);

//internal/admin aliases for the same operations
router.post(
  "/internal/payment-intents/:id/capture",
  validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"),
  validatePaymentIntentIdParam,
  captureStripePaymentIntent
);

router.post(
  "/internal/payment-intents/:id/cancel",
  validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"),
  validatePaymentIntentIdParam,
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
  canMoveCollectedMoney,
  validateRefundPayload,
  refundStripePaymentIntent
);

//create a partial refund
router.post(
  "/partial-refund",
  canMoveCollectedMoney,
  validateRefundPayload,
  partialRefundStripePaymentIntent
);

router.post(
  "/internal/refund",
  validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"),
  validateRefundPayload,
  refundStripePaymentIntent
);

router.post(
  "/internal/partial-refund",
  validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"),
  validateRefundPayload,
  partialRefundStripePaymentIntent
);
//removing duplicate entries in database
router.delete("/remove-duplicate/:id",  removeDuplicateEntries);

//!new route for transaction model fro new design
//*saving new transaction
router.post("/save-transaction", saveTransaction);

//*saving new transaction
router.post("/save-transaction-admin-dashboard", saveTransactionAdmin);

//*saving new transaction
router.post(
  "/save-transaction-template-no-regular-user",
  saveTransactionTemplateForNoRegularUser
);

//*saving new transaction
router.get("/transaction", getListOfAllSavedTransaction);

//*remove duplicate entry in transaction document
router.delete("/removing/:id", removeDuplicateEntry);

//search subscription information
router.get("/subscriptions/:id", searchSubscriptions);

//updating stored subscription
router.patch("/updating-subscription/:id", updateSubcriptionInCompanyAccount);

//cancel subscription
router.delete("/subscriptions/:id", cancelSubscriptionCompany);

//updating stripe company account
router.post("/company-account-stripe/update", stripeCompanyAccountUpdate);

module.exports = router;
