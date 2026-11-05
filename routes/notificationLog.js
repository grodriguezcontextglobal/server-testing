/**
 * Auth Route
 * host + /api/notification_log
 */

const { Router } = require("express");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();

const {
    feedNotificationLog, notificationLogList
} = require("../controller/notificationLog");

// feed event log
router.post("/notification-feed-log", validateJWT, checkTokenVersion, feedNotificationLog)

//render list of log
router.get("/notification-log-list", validateJWT, checkTokenVersion, notificationLogList)

module.exports = router;