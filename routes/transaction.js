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

// A8 (2026-10-27): con sesión de staff, la transacción tiene que ser de la
// compañía del contexto (middlewares/requireStripeOwnership.js,
// STRIPE_OWNERSHIP_MODE=warn por defecto). En las rutas de dos carriles solo
// se comprueba con sesión: sin ella es la app de consumidor.
const { requireStripeOwnership } = require("../middlewares/requireStripeOwnership");
const ownsBodyCompany = requireStripeOwnership("company", (req) => req.body?.company);
const ownsBodyCompanyIfStaff = requireStripeOwnership("company", (req) => req.body?.company, { onlyWithSession: true });
const ownsFindCompany = requireStripeOwnership("company", (req) => req.body?.find?.company);
const scopesBodyListIfStaff = requireStripeOwnership("company", (req) => req.body?.company, {
  injectBodyCompany: true,
  onlyWithSession: true,
});
const scopesQueryListIfStaff = requireStripeOwnership("company", (req) => req.query?.company, {
  injectCompany: (req, companyId) => {
    req.transactionScopeCompany = companyId;
  },
  onlyWithSession: true,
});
const ownsParamTransaction = requireStripeOwnership("transaction", (req) => req.params.id);
const ownsParamTransactionIfStaff = requireStripeOwnership("transaction", (req) => req.params.id, { onlyWithSession: true });
const ownsParamPaymentIntent = requireStripeOwnership("paymentIntent", (req) => req.params.id);
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
  ownsBodyCompanyIfStaff,
  saveTransaction
);

//*saving new transaction
router.post("/save-transaction-admin-dashboard", staffOnly, ownsBodyCompany, saveTransactionAdmin);

//*saving new transaction
router.post(
  "/save-transaction-template-no-regular-user",
  staffOnly,
  ownsBodyCompany,
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
  scopesBodyListIfStaff,
  getListOfAllSavedTransaction
);

//getting list of all saved transaction
// Sin sesión la usaba la página pública /receipt del dashboard: devolvía la
// transacción entera (con nombre y email) a quien conociera el paymentIntent.
// Desde 2026-10-20 el QR lleva un token y la página lee GET /receipt. Esta ruta
// sin sesión pasa por RECEIPT_PUBLIC_READ_MODE: warn (por defecto, registra y
// deja pasar, para los recibos ya impresos sin token) | enforce (401).
router.get("/transaction", optionalJWT, anonymousTransactionRead, scopesQueryListIfStaff, gettingListOfSavedTransaction);

// Recibo con QR firmado (controller/receiptLinkHandlers.js). El enlace solo lo
// emite el staff, para pagos de su compañía; caduca al fin del evento + 30 días.
router.post("/receipt-link", staffOnly, ownsBodyPaymentIntent, issueReceiptLink);
router.get("/receipt", getPublicReceipt);

//*update transaction
router.patch("/update-transaction/:id", staffOnly, ownsParamTransaction, updateTransaction);

//*remove duplicate entry in transaction document
router.delete("/remove-duplicate-transaction/:id", optionalJWT, ownsParamTransactionIfStaff, removeDuplicateEntry);

//retrieve subscription thru payment intent id
router.get("/subscriptions/:id", staffOnly, ownsParamPaymentIntent, retrieveSubscriptionID);

//update multiple documents at once
router.post("/update-multiple-documents", staffOnly, ownsFindCompany, updateMultipleDocuments);

//check payment intent and release deposit transactions if still pending
router.post("/check-and-release-deposit-transactions", staffOnly, ownsBodyCompany, checkingAndReleasingDepositTransactions);

module.exports = router;
