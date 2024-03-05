/**
 * Auth Route
 * host + /api/notification_log
 */

const { Router } = require("express");
const router = Router();

const {
    feedNotificationLog, notificationLogList
} = require("../controller/notificationLog");

// feed event log
router.post("/notification-feed-log", feedNotificationLog)

//render list of log
router.get("/notification-log-list", notificationLogList)

module.exports = router;