/**
 * Auth Route
 * host + /api/db_lease
 */

const { Router } = require("express");
const { insertingNewLease, consultingLease, updateLeaseInfo, insertingNewLeaseConsumer, consultingConsumerLease, updateConsumerLeaseInfo } = require("../controllers/lease");
const router = Router();

//check event info
router.post("/consulting-lease", consultingLease)

//check consumer lease
router.post("/consulting-consumer-lease", consultingConsumerLease)

//insert new event
router.post('/new-lease', insertingNewLease)

//insert new event
router.post('/new-consumer-lease', insertingNewLeaseConsumer)

//insert new staff in event
router.post('/update-lease-info', updateLeaseInfo)

//insert new staff in event
router.post('/update-consumer-lease-info', updateConsumerLeaseInfo)

module.exports = router;