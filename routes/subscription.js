/**
 * Auth Route
 * host + /api/subscription
 */

const { Router } = require("express");
const { createSubscription, searchSubscription, updateSubscription, populateSubscriptionCompany } = require("../controller/subscription");
const { searchingSubscriptionInStripe, createSubscriptionNoTrialPeriod, retrieveSubscriptionID } = require("../controller/stripe");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { requireStripeOwnership } = require("../middlewares/requireStripeOwnership");
const router = Router();

// AC-3 (2026-11-03): con sesión, la suscripción tiene que ser de la compañía
// del contexto, y quien llama, empleado activo de esa compañía. Antes cualquier
// staff leía, creaba o cambiaba la suscripción de cualquier compañía por su
// nombre o su id. Mismas guardas y mismo STRIPE_OWNERSHIP_MODE (warn por
// defecto) que /api/stripe; ver middlewares/requireStripeOwnership.js.
// Cada guarda lee el MISMO campo que su controlador.
const ownsBodyCompanyName = requireStripeOwnership("companyName", (req) => req.body?.company);
const ownsSearchCompanyName = requireStripeOwnership("companyName", (req) => req.body?.company ?? req.query?.company);
const ownsBodyCompanyNameField = requireStripeOwnership("companyName", (req) => req.body?.companyName);
const ownsParamSubscriptionRecord = requireStripeOwnership("subscriptionRecord", (req) => req.params.id);
// El body de update-subscription es el documento nuevo: si trae `company`, no
// puede mover la suscripción a otra compañía.
const ownsNewSubscriptionCompany = requireStripeOwnership("companyName", (req) => req.body.newSubscriptionData.company);
const keepsSubscriptionCompany = (req, res, next) =>
  req.body?.newSubscriptionData?.company == null ? next() : ownsNewSubscriptionCompany(req, res, next);
const ownsBodyCustomer = requireStripeOwnership("customer", (req) => req.body?.stripeCustomerID);
const ownsParamSubscription = requireStripeOwnership("subscription", (req) => req.params.id);
const ownsParamPaymentIntent = requireStripeOwnership("paymentIntent", (req) => req.params.id);
const requireSession = [validateJWT, checkTokenVersion];

//*create subscription
router.post("/new_subscription", requireSession, ownsBodyCompanyName, createSubscription)

//*create subscription no trail period
router.post("/new_subscription_no_trial", requireSession, ownsBodyCustomer, createSubscriptionNoTrialPeriod)

//*search subscription
router.post("/search_subscription", requireSession, ownsSearchCompanyName, searchSubscription)

//*search subscription
router.get("/search_subscription", requireSession, ownsSearchCompanyName, searchSubscription)

//*update subscription
router.patch("/update-subscription/:id", requireSession, ownsParamSubscriptionRecord, keepsSubscriptionCompany, updateSubscription)

//*search subscription in stripe
router.get('/subscriptions/:id', requireSession, ownsParamSubscription, searchingSubscriptionInStripe)

//populate company thru subscription
router.post('/company-subscription', requireSession, ownsBodyCompanyNameField, populateSubscriptionCompany)

//retrieve subscription thru payment intent id
router.get('/searching-subscription/subscriptions/:id', requireSession, ownsParamPaymentIntent, retrieveSubscriptionID)

module.exports = router;
  