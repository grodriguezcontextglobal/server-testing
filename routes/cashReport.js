/**
 * Auth Route
 * host + /api/cash-report
 */

const { Router } = require("express");
const router = Router();
const { createReport, cashReport } = require("../controller/cashReport");

//create new report
router.post("/create-cash-report", createReport);

//list cash report
router.get("/cash-report", cashReport);

//list cash report with params
router.post("/cash-reports", cashReport);

module.exports = router;
