/**
 * Auth Route
 * host + /api/db_lease
 */

const { Router } = require("express");
const { insertingNewLease, consultingLease, updateLeaseInfo, insertingNewLeaseConsumer, consultingConsumerLease, updateConsumerLeaseInfo, deleteConsumerLeaseInfo, deleteLeaseInfo } = require("../controllers/lease");
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

//delete lease row
router.post('/delete-lease-info', deleteLeaseInfo)

//delete consumer lease row
router.post('/delete-consumer-lease-info', deleteConsumerLeaseInfo)

module.exports = router;