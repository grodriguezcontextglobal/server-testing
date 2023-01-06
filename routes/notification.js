/**
 * Auth Route
 * host + /api/notification
 */

const { Router } = require("express");
const router = Router();

const { newMessage, listOfMessages } = require("../controller/notification");

//new message
router.post("/new-message", newMessage);

router.get("/notifications", listOfMessages)

module.exports = router;
