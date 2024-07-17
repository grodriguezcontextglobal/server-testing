/**
 * Auth Route
 * host + /api/subscription
 */

const { Router } = require("express");
const { createSubscription, searchSubscription, updateSubscription, populateSubscriptionCompany } = require("../controller/subscription");
const { searchingSubscriptionInStripe, createSubscriptionNoTrialPeriod } = require("../controller/stripe");
const router = Router();

//*create subscription
router.post("/new_subscription", createSubscription)

//*create subscription no trail period
router.post("/new_subscription_no_trial", createSubscriptionNoTrialPeriod)

//*search subscription
router.post("/search_subscription", searchSubscription)

//*search subscription
router.get("/search_subscription", searchSubscription)

//*update subscription
router.patch("/update-subscription/:id", updateSubscription)

//*search subscription in stripe
router.get('/subscriptions/:id', searchingSubscriptionInStripe)

//populate company thru subscription
router.post('/company-subscription', populateSubscriptionCompany)

//populateSubscriptionCompany
module.exports = router;
  