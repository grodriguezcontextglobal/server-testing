/**
 * Auth Route
 * host + /api/subscription
 */

const { Router } = require("express");
const { createSubscription, searchSubscription, updateSubscription } = require("../controller/subscription");
const { searchingSubscriptionInStripe } = require("../controller/stripe");
const router = Router();

//*create subscription
router.post("/new_subscription", createSubscription)

//*search subscription
router.post("/search_subscription", searchSubscription)

//*search subscription
router.get("/search_subscription", searchSubscription)

//*update subscription
router.patch("/update-subscription/:id", updateSubscription)

//*search subscription in stripe
router.get('/subscriptions/:id', searchingSubscriptionInStripe)

module.exports = router;
