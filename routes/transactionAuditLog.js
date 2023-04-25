/**
 * Auth Route
 * host + /api/transactionAuditLog
 */

const { Router } = require("express");
const router = Router();
const apicache = require('apicache')
const { createAuditLog, displayTransactionAuditLog } = require("../controller/transactionAuditLog");
const cache = apicache.middleware
// create audit log event
router.post("/create-audit", createAuditLog)

//display all events in audit log
router.get("/audit-log",cache("1 minute"), displayTransactionAuditLog)

module.exports = router;