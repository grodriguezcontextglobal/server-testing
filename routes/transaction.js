/**
 * Auth Route
 * host + /api/transaction
 */

const { Router } = require("express");
const { consumerTokenGate } = require("../middlewares/consumerTokenGate");
const router = Router();
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { optionalJWT } = require("../middlewares/optionalJWT");
const {
  saveTransaction,
  saveTransactionAdmin,
  saveTransactionTemplateForNoRegularUser,
  getListOfAllSavedTransaction,
  removeDuplicateEntry,
  updateTransaction,
  updateMultipleDocuments,
  gettingListOfSavedTransaction,
  checkingAndReleasingDepositTransactions,
} = require("../controller/transaction");
const { retrieveSubscriptionID } = require("../controller/stripe");

// Staff only (2026-10-15). The consumer app (app.devitrak.net, repo devitrak)
// calls none of these, and the dashboard only calls update-transaction and
// update-multiple-documents, always with a session. Not here on purpose:
// - POST /transaction, POST /save-transaction, DELETE /remove-duplicate-transaction/:id
//   are called by the consumer app without a session: optionalJWT + two lanes
//   in the controller (staff session = full; no session = helpers/publicTransactionLane.js;
//   dashboard origin without session = 401).
// - GET /transaction backs the dashboard's public /receipt page (QR scan, no
//   session); it needs a signed receipt token before it can be closed.
const staffOnly = [validateJWT, checkTokenVersion];

const { issueReceiptLink, getPublicReceipt } = require("../controller/receiptLink");
const { requirePaymentOwnership } = require("../middlewares/requirePaymentOwnership");
const { isStaffSession } = require("../helpers/consumerUserFilter");
const logger = require("../helpers/logger");
const ownsBodyPaymentIntent = requirePaymentOwnership((req) => req.body?.paymentIntent);

const anonymousTransactionRead = async (req, res, next) => {
  try {
    if (await isStaffSession(req)) return next();
  } catch {
    // sin poder comprobar la sesión, se trata como anónima
  }
  if ((process.env.RECEIPT_PUBLIC_READ_MODE || "warn") === "enforce") {
    return res.status(401).json({ ok: false, msg: "Sign in to view this transaction." });
  }
  logger.warn("transaction: anonymous GET /transaction allowed (RECEIPT_PUBLIC_READ_MODE=warn)", {
    origin: req.header?.("origin"),
    query: Object.keys(req.query || {}).join(","),
  });
  return next();
};

//*saving new transaction
router.post(
  "/save-transaction",
  optionalJWT,
  consumerTokenGate({
    eventScoped: true,
    subject: (req) => ({
      consumerId: req.body?.consumerInfo?.id,
      email: req.body?.consumerInfo?.email,
      eventId: req.body?.event_id,
      eventName: req.body?.eventSelected,
    }),
  }),
  saveTransaction
);

//*saving new transaction
router.post("/save-transaction-admin-dashboard", staffOnly, saveTransactionAdmin);

//*saving new transaction
router.post(
  "/save-transaction-template-no-regular-user",
  staffOnly,
  saveTransactionTemplateForNoRegularUser
);

//*saving new transaction
router.post(
  "/transaction",
  optionalJWT,
  consumerTokenGate({
    // Con nivel email, solo las transacciones de este evento (no el historial).
    eventScoped: true,
    subject: (req) => ({ email: req.body?.["consumerInfo.email"], eventId: req.body?.event_id }),
  }),
  getListOfAllSavedTransaction
);

//getting list of all saved transaction
// Sin sesión la usaba la página pública /receipt del dashboard: devolvía la
// transacción entera (con nombre y email) a quien conociera el paymentIntent.
// Desde 2026-10-20 el QR lleva un token y la página lee GET /receipt. Esta ruta
// sin sesión pasa por RECEIPT_PUBLIC_READ_MODE: warn (por defecto, registra y
// deja pasar, para los recibos ya impresos sin token) | enforce (401).
router.get("/transaction", optionalJWT, anonymousTransactionRead, gettingListOfSavedTransaction);

// Recibo con QR firmado (controller/receiptLinkHandlers.js). El enlace solo lo
// emite el staff, para pagos de su compañía; caduca al fin del evento + 30 días.
router.post("/receipt-link", staffOnly, ownsBodyPaymentIntent, issueReceiptLink);
router.get("/receipt", getPublicReceipt);

//*update transaction
router.patch("/update-transaction/:id", staffOnly, updateTransaction);

//*remove duplicate entry in transaction document
router.delete("/remove-duplicate-transaction/:id", optionalJWT, removeDuplicateEntry);

//retrieve subscription thru payment intent id
router.get("/subscriptions/:id", staffOnly, retrieveSubscriptionID);

//update multiple documents at once
router.post("/update-multiple-documents", staffOnly, updateMultipleDocuments);

//check payment intent and release deposit transactions if still pending
router.post("/check-and-release-deposit-transactions", staffOnly, checkingAndReleasingDepositTransactions);

module.exports = router;
