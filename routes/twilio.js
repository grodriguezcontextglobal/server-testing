/**
 * Auth Route
 * host + /api/twilio
 */

const { Router } = require("express");
const router = Router();

const { whatsappNotification, SMSNotification } = require("../controller/twilio");

//create whatsapp notification
router.post("/send-whatsapp-notification", whatsappNotification);

//create SMS notification
router.post("/send-sms-notification", SMSNotification);

module.exports = router;
