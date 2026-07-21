/**
 * Auth Route
 * host + /api/db_lease
 */

const { Router } = require("express");
const { insertingNewLease, consultingLease, updateLeaseInfo, insertingNewLeaseConsumer, consultingConsumerLease, updateConsumerLeaseInfo, deleteConsumerLeaseInfo, deleteLeaseInfo, retrieveLeaseStatus } = require("../controllers/lease");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");
const router = Router();

// Unified device-lease status spans devices (inventory), so it is gated by
// inventory:read + an authenticated staff session. NOTE: the legacy lease
// routes below predate auth and remain unguarded — out of scope to change here.
const canReadInventory = [validateJWT, checkTokenVersion, authorizePermission("inventory", "read")];

// unified device-lease status across staff/consumer/member (authenticated)
router.post("/status", canReadInventory, retrieveLeaseStatus)

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