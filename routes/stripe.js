/**
 * Auth Route
 * host + /api/stripe
 */

const { Router } = require("express");
const { check } = require("express-validator");
const validateFields = require("../middlewares/validate-field");
const { consumerTokenGate } = require("../middlewares/consumerTokenGate");
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

// Stripe Fase 2 (FedRAMP A8, 2026-10-27). optionalJWT, en el router.use, lee
// la sesión si viene pero no la exige: 26 rutas de cobro, suscripción y
// facturación respondían a cualquiera (cancelar la suscripción de una compañía,
// buscar pagos, guardar transacciones). Todas las llama solo el dashboard desde
// páginas con sesión (comprobado contra testing-admin-dashboard b53a1992 y la
// app de consumidor 3fccd69, que solo usa rutas con consumerTokenGate).
//
// Regla (decisión del 2026-10-27): suscripciones, cobros, reembolsos y
// capturas exigen sesión. Crear un payment intent no, porque también se hace
// desde sesiones no autenticadas; pero si viene de la app de consumidor, su
// token se valida (consumerTokenGate). Siguen públicas, y lo fija
// test/stripeRouteIdentity.test.js: las tres de crear payment intent y las
// cuatro del alta de compañía, que corre antes de que exista sesión
// (company-account-stripe, new-company-account, accounts y account_link).
const requireSession = [validateJWT, checkTokenVersion];

// A8b (2026-10-27): con sesión, el recurso de Stripe tiene que ser de la
// compañía del contexto (middlewares/requireStripeOwnership.js). Cada guarda
// lee el MISMO campo que su controlador. STRIPE_OWNERSHIP_MODE=warn por defecto.
const { requireStripeOwnership } = require("../middlewares/requireStripeOwnership");
const ownsParamSubscription = requireStripeOwnership("subscription", (req) => req.params.id);
const ownsBodySubscription = requireStripeOwnership("subscription", (req) => req.body?.subscriptionID);
const ownsBodyCustomer = requireStripeOwnership("customer", (req) => req.body?.stripeCustomerID);
const ownsBodyCustomerID = requireStripeOwnership("customer", (req) => req.body?.customerID);
const ownsBodySetupIntent = requireStripeOwnership("setupIntent", (req) => req.body?.setupId);
const ownsBodyPaymentIntentId = requireStripeOwnership("paymentIntent", (req) => req.body?.paymentIntentId);
const ownsBodyConnectedAccount = requireStripeOwnership("connectedAccount", (req) => req.body?.connectedAccountId);
const ownsParamStripeCompany = requireStripeOwnership("stripeCompany", (req) => req.params.id);
// Transacciones guardadas, listadas o borradas desde /api/stripe.
const ownsBodyCompany = requireStripeOwnership("company", (req) => req.body?.company);
const scopesListToCompany = requireStripeOwnership("company", (req) => req.body?.company, { injectBodyCompany: true });
const ownsParamTransaction = requireStripeOwnership("transaction", (req) => req.params.id);
const ownsParamStripeTransaction = requireStripeOwnership("stripeTransaction", (req) => req.params.id);
const scopesPaymentSearch = requireStripeOwnership("paymentIntentSearch");

// Fase 0.1 (2026-10-19): el pago tiene que ser de la compañía del contexto
// (middlewares/requirePaymentOwnership.js). Se comprueba el MISMO campo que lee
// cada controlador: capture/cancel usan body.id, refund/partial-refund
// body.paymentIntent (ya normalizado por validateRefundPayload).
const { requirePaymentOwnership } = require("../middlewares/requirePaymentOwnership");
const ownsBodyId = requirePaymentOwnership((req) => req.body?.id);
const ownsBodyPaymentIntent = requirePaymentOwnership((req) => req.body?.paymentIntent);
// capture/cancel llevan el pi_ en la URL y en el body (el dashboard manda el
// mismo en los dos) y el controlador usa el del body: si no coinciden, 422, para
// que nunca se compruebe un pago y se mueva otro.
const sameIdInUrlAndBody = (req, res, next) =>
  req.body?.id === req.params.id
    ? next()
    : res.status(422).json({ ok: false, msg: "The payment intent in the URL and in the body must match" });
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

router.post("/customer", consumerTokenGate({ subject: (req) => ({ email: req.body?.email }) }), stripeCustomer);

//create account
router.post("/accounts", stripeAccountCreate);

//router account link
router.post("/account_link", stripeAccountLink);

//create account session
router.post("/account_sessions", requireSession, ownsBodyConnectedAccount, stripeAccountSession);

//create payment intent
router.post(
  "/create-payment-intent",
  validatePublicPaymentPayload,
  attachServerIdempotencyKey,
  consumerTokenGate({ subject: (req) => ({ email: req.body?.customerEmail }) }),
  stripePaymentIntent
);

//create payment intent from admin side
// Sin sesión de staff, pero desde la app de consumidor el token se valida otra
// vez, como en /create-payment-intent (el gate no actúa sobre el dashboard).
router.post(
  "/create-payment-intent-customized",
  consumerTokenGate({ subject: (req) => ({ email: req.body?.receipt_email }) }),
  stripePaymentIntentCustomized
);

//create payment intent for subscription
router.post(
  "/create-payment-intent-subscription",
  consumerTokenGate({ subject: (req) => ({ email: req.body?.customerEmail }) }),
  stripePaymentIntentSubscription
);

//create new company customer for subscriptions
router.post("/new-company-account", companyInformationAccountStripe);

//route to create subscription from tiers and make charges monthly/yearly
router.post("/create-subscriptions", requireSession, ownsBodyCustomer, creatingSubscription);

//*create subscription no trail period from tiers and make charges monthly/yearly
router.post("/create-subscriptions_no_trial", requireSession, ownsBodyCustomer, createSubscriptionNoTrialPeriod);

//update payment method in subscription
router.post(
  "/payment-method/subscriptions/:id",
  requireSession,
  ownsParamSubscription,
  updateDefaultPaymentMethodInSubscription
);

//update payment method in customer
router.post(
  "/payment_methods/:id/attach",
  requireSession,
  ownsBodyCustomerID,
  updateDefaultPaymentMethodInCustomer
);

//update payment method in customer
router.post(
  "/payment_intents/:id/update-payment-method",
  requireSession,
  ownsBodyPaymentIntentId,
  updatePaymentMethodFromAdminDashboard
);

//list all payment intent created
router.get("/payment-intents/search", requireSession, scopesPaymentSearch, searchStripeTransaction);

//search subscription by setup id
router.post("/setup-search", requireSession, ownsBodySetupIntent, findSubscriptionIdBySetUpId);

//list all customers created
router.get("/customers", validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "read"), listAllCustomers);

//list all customers created
router.post("/customers", validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "read"), listAllCustomers);

//search customer
router.get("/customers/search", validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "read"), searchCustomerId);

//retrieve paymentIntent
// Exige el enlace del correo (nivel verified). Comprobar que el pago es de ese
// consumidor necesitaría buscar la transacción (pendiente).
router.get("/payment_intents/:id", consumerTokenGate({ verifiedOnly: true }), retrievePaymentIntent);

//get list of stripe transactions saved
router.get(
  "/stripe-transactions-saved-list",
  requireSession,
  scopesListToCompany,
  getListOfAllSavedStripeTransaction
);

//get saved stripe transaction by query
router.post(
  "/stripe-transactions-saved-list",
  requireSession,
  scopesListToCompany,
  getListOfAllSavedStripeTransaction
);

//finding company stripe account
// Pública (alta de compañía, antes de que haya sesión). `company` tiene que
// ser un string: con {"$ne": null} o {"$regex": ...} devolvía la cuenta de
// Stripe (stripeID, email y nombre del dueño) de otra compañía (SI-10,
// 2026-11-02). El dashboard manda siempre `company` como texto.
router.post(
  "/company-account-stripe/",
  [
    check("company", "company must be a non-empty string")
      .custom((value) => typeof value === "string" && value.trim().length > 0),
    validateFields,
  ],
  stripeCompanyAccountFound
);

//retrieve all invoices per subscription
router.get("/invoices", requireSession, ownsBodySubscription, displayAllPaidInvoicesPerSubscription);

//retrieve all invoices per subscription
router.post("/invoices", requireSession, ownsBodySubscription, displayAllPaidInvoicesPerSubscription);

//update subscription for cancel at the end of period or
router.post("/cancel/subscriptions/:id", requireSession, ownsParamSubscription, updateCancelSubscription);

//save object {device, paymentIntentId, clientSecret} in database
router.post(
  "/stripe-transaction",
  consumerTokenGate({
    eventScoped: true,
    subject: (req) => ({
      consumerId: req.body?.user,
      companyId: req.body?.company,
      eventName: req.body?.eventSelected,
    }),
  }),
  saveStripeTransaction
);

//save object {device, paymentIntentId, clientSecret} in database
router.post("/stripe-transaction-admin", validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"), saveStripeTransactionAdmin);

//capture payment intent amount
router.post(
  "/payment-intents/:id/capture",
  canMoveCollectedMoney,
  validatePaymentIntentIdParam,
  sameIdInUrlAndBody,
  ownsBodyId,
  captureStripePaymentIntent
);

//cancel payment intent amount
router.post(
  "/payment-intents/:id/cancel",
  canMoveCollectedMoney,
  validatePaymentIntentIdParam,
  sameIdInUrlAndBody,
  ownsBodyId,
  cancelStripePaymentIntent
);

//internal/admin aliases for the same operations
router.post(
  "/internal/payment-intents/:id/capture",
  validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"),
  validatePaymentIntentIdParam,
  sameIdInUrlAndBody,
  ownsBodyId,
  captureStripePaymentIntent
);

router.post(
  "/internal/payment-intents/:id/cancel",
  validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"),
  validatePaymentIntentIdParam,
  sameIdInUrlAndBody,
  ownsBodyId,
  cancelStripePaymentIntent
);

//save No regular user object {device, paymentIntentId, clientSecret} in database
router.post(
  "/stripe-transaction-no-regular-user",
  requireSession,
  ownsBodyCompany,
  saveStripeTransactionTemplateForNoRegularUser
);

//create a refund
router.post(
  "/refund",
  canMoveCollectedMoney,
  validateRefundPayload,
  ownsBodyPaymentIntent,
  refundStripePaymentIntent
);

//create a partial refund
router.post(
  "/partial-refund",
  canMoveCollectedMoney,
  validateRefundPayload,
  ownsBodyPaymentIntent,
  partialRefundStripePaymentIntent
);

router.post(
  "/internal/refund",
  validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"),
  validateRefundPayload,
  ownsBodyPaymentIntent,
  refundStripePaymentIntent
);

router.post(
  "/internal/partial-refund",
  validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"),
  validateRefundPayload,
  ownsBodyPaymentIntent,
  partialRefundStripePaymentIntent
);
//removing duplicate entries in database
router.delete("/remove-duplicate/:id", requireSession, ownsParamStripeTransaction, removeDuplicateEntries);

//!new route for transaction model fro new design
//*saving new transaction
router.post("/save-transaction", requireSession, ownsBodyCompany, saveTransaction);

//*saving new transaction
router.post("/save-transaction-admin-dashboard", requireSession, ownsBodyCompany, saveTransactionAdmin);

//*saving new transaction
router.post(
  "/save-transaction-template-no-regular-user",
  requireSession,
  ownsBodyCompany,
  saveTransactionTemplateForNoRegularUser
);

//*saving new transaction
router.get("/transaction", requireSession, scopesListToCompany, getListOfAllSavedTransaction);

//*remove duplicate entry in transaction document
router.delete("/removing/:id", requireSession, ownsParamTransaction, removeDuplicateEntry);

//search subscription information
router.get("/subscriptions/:id", requireSession, ownsParamSubscription, searchSubscriptions);

//updating stored subscription
router.patch("/updating-subscription/:id", requireSession, ownsParamStripeCompany, updateSubcriptionInCompanyAccount);

//cancel subscription
router.delete("/subscriptions/:id", requireSession, ownsParamSubscription, cancelSubscriptionCompany);

//updating stripe company account
router.post("/company-account-stripe/update", requireSession, ownsBodyConnectedAccount, stripeCompanyAccountUpdate);

module.exports = router;
