/**
 * Auth Route
 * host + /api/receiver
 */

 const { Router } = require("express");
 const router = Router();
 const { check } = require("express-validator");

const { addReceiverToTransaction, checkingReceiversAssigned } = require("../controller/receiver");
 const validateFields = require("../middlewares/validate-field");
 const { validateJWT } = require("../middlewares/validate-jwt");
 
 //post receivers per user per transaction
 router.post("/receiver-assignation", addReceiverToTransaction )

 //check paymentIntent was used for receivers
 router.post("/receiver-assigned", checkingReceiversAssigned )
 
 
 module.exports = router;