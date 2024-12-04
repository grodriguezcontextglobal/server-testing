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
  trackReturnedReceiverWithIssue,
  getListOfReceiverReturnedByIssue,
  updateIssueDevice,
  listOfAssignedReceiverPlusUserInformation,
  receiverPoolFoundAndDelete,
  getListOfItemsInEventPool,
  updateBulkItemsInTransaction,
  updateBulkItemsInPool,
} = require("../controller/receiver");

//post receivers per user per transaction
router.post("/receiver-assignation", addReceiverToTransaction);

//check paymentIntent was used for receivers
router.post("/receiver-assigned", checkingReceiversAssigned);

//add receivers to pool
router.post("/receivers-pool", poolReceivers);

//track receiver returned by issue
router.post("/receiver-returned-issue", trackReturnedReceiverWithIssue);

//update entire data of an assigned receiver
router.put("/receiver-update/:id", udpateReceiverStatus);

//update specific value of receiver assigned data
router.patch("/receiver-update/:id", udpateReceiverStatus);

//update specific value of receiver data in pool
router.patch("/receivers-pool-update/:id", updatePoolReceivers);

//update specific value of an issue receiver data
router.patch("/receiver-returned-issue/:id", updateIssueDevice);

//render all device in pool
router.post("/receiver-pool-list", receiverPoolList);

//render list of items in event pool
router.get("/receiver-pool-list", getListOfItemsInEventPool);

//render list of all assigned receiver
router.post("/receiver-assigned-list", listOfAssignedReceiver);

//render list of all assigned receiver
router.post(
  "/receiver-assigned-users-list",
  listOfAssignedReceiverPlusUserInformation
);

//render all receiver returned by issue
router.get("/list-receiver-returned-issue", getListOfReceiverReturnedByIssue);

//render all receiver returned by issue
router.post("/list-receiver-returned-issue", getListOfReceiverReturnedByIssue);

//update entire data of an assigned receiver
router.put("/receiver-update/:id", udpateReceiverStatus);

//update specific value of receiver assigned data
router.patch("/receiver-update/:id", udpateReceiverStatus);

// //update specific value of receiver data in pool
// router.patch("/receivers-pool-update/:id", updatePoolReceivers);

//update specific value of an issue receiver data
router.patch("/receiver-returned-issue/:id", updateIssueDevice);

//find and delete device from pool document
router.delete("/delete-device-pool/:id", receiverPoolFoundAndDelete);

//find and delete device from pool document
router.delete("/receiver-pool-device/:id", receiverPoolFoundAndDelete);

//update specific value of multiple items in transaction
router.patch("/update-bulk-items-in-transaction", updateBulkItemsInTransaction);

//update specific value of multiple items in pool
router.patch("/update-bulk-items-in-pool", updateBulkItemsInPool);

module.exports = router;
