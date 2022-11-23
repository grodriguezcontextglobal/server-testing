/**
 * Auth Route
 * host + /api/receiver
 */

const { Router } = require("express");
const router = Router();

const {
  addReceiverToTransaction,
  checkingReceiversAssigned,
  udpateReceiverStatus,
  poolReceivers,
  updatePoolReceivers,
  receiverPoolList,
  listOfAssignedReceiver,
} = require("../controller/receiver");

//post receivers per user per transaction
router.post("/receiver-assignation", addReceiverToTransaction);

//check paymentIntent was used for receivers
router.post("/receiver-assigned", checkingReceiversAssigned);

//update receiver assigned data
router.put("/receiver-update/:id", udpateReceiverStatus);

//add receivers to pool
router.post("/receivers-pool", poolReceivers);

//update receivers to pool
router.put("/receivers-pool-update/:id", updatePoolReceivers);

router.get("/receiver-pool-list", receiverPoolList);

router.get("/receiver-assigned-list", listOfAssignedReceiver)

module.exports = router;
