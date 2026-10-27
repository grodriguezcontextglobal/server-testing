/**
 * Auth Route
 * host + /api/subscription
 */

const { Router } = require("express");
const { createSubscription, searchSubscription, updateSubscription, populateSubscriptionCompany } = require("../controller/subscription");
const { searchingSubscriptionInStripe, createSubscriptionNoTrialPeriod, retrieveSubscriptionID } = require("../controller/stripe");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();

//*create subscription
router.post("/new_subscription", validateJWT, checkTokenVersion, createSubscription)

//*create subscription no trail period
router.post("/new_subscription_no_trial", validateJWT, checkTokenVersion, createSubscriptionNoTrialPeriod)

//*search subscription
router.post("/search_subscription", validateJWT, checkTokenVersion, searchSubscription)

//*search subscription
router.get("/search_subscription", validateJWT, checkTokenVersion, searchSubscription)

//*update subscription
router.patch("/update-subscription/:id", validateJWT, checkTokenVersion, updateSubscription)

//*search subscription in stripe
router.get('/subscriptions/:id', validateJWT, checkTokenVersion, searchingSubscriptionInStripe)

//populate company thru subscription
router.post('/company-subscription', validateJWT, checkTokenVersion, populateSubscriptionCompany)

//retrieve subscription thru payment intent id
router.get('/searching-subscription/subscriptions/:id', validateJWT, checkTokenVersion, retrieveSubscriptionID)

module.exports = router;
  