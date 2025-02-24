/**
 * Auth Route
 * host + /api/error_log
 */

const { Router } = require("express");
const { createErrorFeed } = require("../controller/errorLog");
const router = Router();

//router to create error log successfully
router.post('/error_log', createErrorFeed);

module.exports = router;
