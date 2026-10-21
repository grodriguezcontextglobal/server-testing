/**
 * Auth Route
 * host + /api/receiver
 */

const { Router } = require("express");
const router = Router();
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { optionalJWT } = require("../middlewares/optionalJWT");
const { isStaffOrigin, isStaffSession } = require("../helpers/consumerUserFilter");

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
  poolReceiversBulk,
  updateBulkItemDataInPool,
  createBulkItemTransactionInUser,
  removingItemFromTransaction,
  returnAllItemsInTransactionInPool,
  updateBulkItemsInTransactionPerUserAtOnce,
  receiverPoolBulkDelete,
  getAllTransactionByEventAndConsumer,
} = require("../controller/receiver");

// ─── Denegar por defecto (FedRAMP P1.1 · AC-3, 2026-10-21) ───────────────────
//
// Todo este router exige sesión de staff, salvo las rutas de PUBLIC_ROUTES, que
// se registran ANTES del `router.use` de abajo. Una ruta nueva añadida en este
// fichero nace cerrada. test/receiverRouterGuards.test.js lo comprueba.
//
// Única ruta pública: la app del consumidor (app.devitrak.net, sin login) lee
// sus equipos asignados con { user, eventSelected }. El dashboard la llama
// siempre con sesión.
const PUBLIC_ROUTES = ["POST /receiver-assigned-list"];

// Dos carriles. Con sesión de staff, como siempre. Desde el dashboard sin
// sesión, 401. Sin sesión desde otro origen (la app del consumidor), solo un
// consumidor y un evento, como texto: antes era `Receivers.find(body)` y un body
// vacío devolvía los equipos asignados de todas las compañías.
const assignedListLanes = async (req, res, next) => {
  try {
    if (await isStaffSession(req)) return next();
  } catch {
    // sin poder comprobar la sesión, se trata como anónima
  }
  if (isStaffOrigin(req)) {
    return res.status(401).json({ ok: false, msg: "Authentication is required for this endpoint." });
  }
  const { user, eventSelected } = req.body ?? {};
  if (typeof user !== "string" || !user.trim() || typeof eventSelected !== "string" || !eventSelected.trim()) {
    return res.status(400).json({ ok: false, msg: "user and eventSelected are required." });
  }
  req.body = { user, eventSelected };
  return next();
};

router.post("/receiver-assigned-list", optionalJWT, assignedListLanes, listOfAssignedReceiver);

router.use(validateJWT, checkTokenVersion);

//post receivers per user per transaction
router.post("/receiver-assignation", addReceiverToTransaction);

//check paymentIntent was used for receivers
router.post("/receiver-assigned", checkingReceiversAssigned);

//add receivers to pool
router.post("/receivers-pool", poolReceivers);

//add multiple receivers to pool
router.post("/receivers-pool-bulk", poolReceiversBulk);

//track receiver returned by issue
router.post("/receiver-returned-issue", trackReturnedReceiverWithIssue);

//update entire data of an assigned receiver
router.put("/receiver-update/:id", udpateReceiverStatus);

//update specific value of receiver assigned data
router.patch("/receiver-update/:id", udpateReceiverStatus);

//update specific value of receiver data in pool
router.patch("/receivers-pool-update/:id", updatePoolReceivers);

//update specific value of receiver data in pool
router.patch("/receivers-pool-update-bulk", updateBulkItemDataInPool);

//update specific value of an issue receiver data
router.patch("/receiver-returned-issue/:id", updateIssueDevice);

//render all device in pool
router.post("/receiver-pool-list", receiverPoolList);

//render list of items in event pool
router.get("/receiver-pool-list", getListOfItemsInEventPool);

//render list of all assigned receiver
router.post(
  "/receiver-assigned-users-list",
  listOfAssignedReceiverPlusUserInformation
);

//render all receiver returned by issue
router.get("/list-receiver-returned-issue", getListOfReceiverReturnedByIssue);

//render all receiver returned by issue
router.post("/list-receiver-returned-issue", getListOfReceiverReturnedByIssue);

//find and delete device from pool document
router.delete("/delete-device-pool/:id", receiverPoolFoundAndDelete);

//find and delete device from pool document in bulk way
router.post("/delete-bulk-devices-pool", receiverPoolBulkDelete);

//find and delete device from pool document
router.delete("/receiver-pool-device/:id", receiverPoolFoundAndDelete);

//update specific value of multiple items in transaction
router.patch("/update-bulk-items-in-transaction", updateBulkItemsInTransaction);

//update specific value of multiple items in pool
router.patch("/update-bulk-items-in-pool", updateBulkItemsInPool);

//create bulk item transaction in user
router.post(
  "/create-bulk-item-transaction-in-user",
  createBulkItemTransactionInUser
);

//removing transaction
router.delete("/remove-transaction/:id", removingItemFromTransaction);

//update multiple items in pool with device.serialNumber props
router.patch(
  "/transaction-return-all-items-in-pool",
  returnAllItemsInTransactionInPool
);

//update multiple items in transaction with device.serialNumber props
router.patch(
  "/transaction-all-items-returned-at-once",
  updateBulkItemsInTransactionPerUserAtOnce
);

router.post('/all-transaction-by-event-and-consumer', getAllTransactionByEventAndConsumer)

module.exports = router;
module.exports.PUBLIC_ROUTES = PUBLIC_ROUTES;
