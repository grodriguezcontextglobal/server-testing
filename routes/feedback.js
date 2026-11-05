/**
 * Auth Route
 * host + /api/feedback
 */

const { Router } = require("express");
const { newFeedback } = require("../controller/feedback");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();

//new feedback
router.post("/new-feedback", validateJWT, checkTokenVersion, newFeedback);

module.exports = router;