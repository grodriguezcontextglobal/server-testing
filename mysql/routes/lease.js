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
// inventory:read + an authenticated staff session.
const canReadInventory = [validateJWT, checkTokenVersion, authorizePermission("inventory", "read")];

// The legacy lease routes below were anonymous until 2026-10-19 (FedRAMP S0.1 /
// S1.11). Only the dashboard calls them, always with a session, and the audit
// trail had 0 anonymous writes since 2026-10-05. Session only, no permission
// check yet: a permission would 403 roles that use these screens today.
const staffSession = [validateJWT, checkTokenVersion];

// unified device-lease status across staff/consumer/member (authenticated)
router.post("/status", canReadInventory, retrieveLeaseStatus)

//check event info
router.post("/consulting-lease", staffSession, consultingLease)

//check consumer lease
router.post("/consulting-consumer-lease", staffSession, consultingConsumerLease)

//insert new event
router.post('/new-lease', staffSession, insertingNewLease)

//insert new event
router.post('/new-consumer-lease', staffSession, insertingNewLeaseConsumer)

//insert new staff in event
router.post('/update-lease-info', staffSession, updateLeaseInfo)

//insert new staff in event
router.post('/update-consumer-lease-info', staffSession, updateConsumerLeaseInfo)

//delete lease row
router.post('/delete-lease-info', staffSession, deleteLeaseInfo)

//delete consumer lease row
router.post('/delete-consumer-lease-info', staffSession, deleteConsumerLeaseInfo)

module.exports = router;