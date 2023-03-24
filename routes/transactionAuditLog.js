/**
 * Auth Route
 * host + /api/transactionAuditLog
 */

const { Router } = require("express");
const router = Router();

const { createAuditLog, displayTransactionAuditLog } = require("../controller/transactionAuditLog");

// create audit log event
router.post("/create-audit", createAuditLog)

//display all events in audit log
router.get("/audit-log", displayTransactionAuditLog)

module.exports = router;