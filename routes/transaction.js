/**
 * Auth Route
 * host + /api/transaction
 */

const { Router } = require("express");
const router = Router();
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
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
//   are called by the consumer app without a session (two-lane work, Fase 3.2).
// - GET /transaction backs the dashboard's public /receipt page (QR scan, no
//   session); it needs a signed receipt token before it can be closed.
const staffOnly = [validateJWT, checkTokenVersion];

//*saving new transaction
router.post("/save-transaction", saveTransaction);

//*saving new transaction
router.post("/save-transaction-admin-dashboard", staffOnly, saveTransactionAdmin);

//*saving new transaction
router.post(
  "/save-transaction-template-no-regular-user",
  staffOnly,
  saveTransactionTemplateForNoRegularUser
);

//*saving new transaction
router.post("/transaction", getListOfAllSavedTransaction);

//getting list of all saved transaction
router.get("/transaction", gettingListOfSavedTransaction);

//*update transaction
router.patch("/update-transaction/:id", staffOnly, updateTransaction);

//*remove duplicate entry in transaction document
router.delete("/remove-duplicate-transaction/:id", removeDuplicateEntry);

//retrieve subscription thru payment intent id
router.get("/subscriptions/:id", staffOnly, retrieveSubscriptionID);

//update multiple documents at once
router.post("/update-multiple-documents", staffOnly, updateMultipleDocuments);

//check payment intent and release deposit transactions if still pending
router.post("/check-and-release-deposit-transactions", staffOnly, checkingAndReleasingDepositTransactions);

module.exports = router;
