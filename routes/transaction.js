/**
 * Auth Route
 * host + /api/transaction
 */

const { Router } = require("express");
const router = Router();
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

//*saving new transaction
router.post("/save-transaction", saveTransaction);

//*saving new transaction
router.post("/save-transaction-admin-dashboard", saveTransactionAdmin);

//*saving new transaction
router.post(
  "/save-transaction-template-no-regular-user",
  saveTransactionTemplateForNoRegularUser
);

//*saving new transaction
router.post("/transaction", getListOfAllSavedTransaction);

//getting list of all saved transaction
router.get("/transaction", gettingListOfSavedTransaction);

//*update transaction
router.patch("/update-transaction/:id", updateTransaction);

//*remove duplicate entry in transaction document
router.delete("/remove-duplicate-transaction/:id", removeDuplicateEntry);

//retrieve subscription thru payment intent id
router.get("/subscriptions/:id", retrieveSubscriptionID);

//update multiple documents at once
router.post("/update-multiple-documents", updateMultipleDocuments);

//check payment intent and release deposit transactions if still pending
router.post("/check-and-release-deposit-transactions", checkingAndReleasingDepositTransactions);

module.exports = router;
