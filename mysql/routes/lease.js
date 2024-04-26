/**
 * Auth Route
 * host + /api/db_lease
 */

const { Router } = require("express");
const { insertingNewLease, consultingLease, updateLeaseInfo } = require("../controllers/lease");
const router = Router();

//check event info
router.post("/consulting-lease", consultingLease)

//insert new event
router.post('/new-lease', insertingNewLease)

//insert new staff in event
router.post('/update-lease-info', updateLeaseInfo)

module.exports = router;