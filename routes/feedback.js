/**
 * Auth Route
 * host + /api/feedback
 */

const { Router } = require("express");
const { newFeedback } = require("../controller/feedback");
const router = Router();

//new feedback
router.post("/new-feedback", newFeedback);

module.exports = router;