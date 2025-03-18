/**
 * Auth Route
 * host + /api/cash-report
 */

const { Router } = require("express");
const router = Router();
const { createReport, cashReport, removeCashReportAfterRefund } = require("../controller/cashReport");

//create new report
router.post("/create-cash-report", createReport);

//list cash report
router.get("/cash-report", cashReport);

//list cash report with params
router.post("/cash-reports", cashReport);

//remove cash report
router.post("/remove-cash-report/:id", removeCashReportAfterRefund);

module.exports = router;
