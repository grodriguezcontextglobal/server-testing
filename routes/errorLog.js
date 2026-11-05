/**
 * Auth Route
 * host + /api/error_log
 */

const { Router } = require("express");
const { createErrorFeed } = require("../controller/errorLog");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();

//router to create error log successfully
router.post('/error_log', validateJWT, checkTokenVersion, createErrorFeed);

module.exports = router;
