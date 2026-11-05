/**
 * Auth Route
 * host + /api/cash-report
 */

const { Router } = require("express");
const router = Router();
const { createReport, cashReport, removeCashReportAfterRefund, updateCashReport } = require("../controller/cashReport");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");

//create new report
router.post("/create-cash-report", validateJWT, checkTokenVersion, createReport);

//list cash report
router.get("/cash-report", validateJWT, checkTokenVersion, cashReport);

//list cash report with params
router.post("/cash-reports", validateJWT, checkTokenVersion, cashReport);

//remove cash report
router.post("/remove-cash-report/:id", validateJWT, checkTokenVersion, removeCashReportAfterRefund);

//update cash report
router.patch("/update-cash-report/:id", validateJWT, checkTokenVersion, updateCashReport);

module.exports = router;
