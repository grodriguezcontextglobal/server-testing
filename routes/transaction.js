/**
 * Auth Route
 * host + /api/transaction
 */

const { Router } = require("express");
const router = Router();
const { validateJWT } = require("../middlewares/validate-jwt");
const { saveTransaction,
    saveTransactionAdmin,
    saveTransactionTemplateForNoRegularUser,
    getListOfAllSavedTransaction,
    removeDuplicateEntry,
    updateTransaction } = require("../controller/transaction");

//*saving new transaction
router.post("/save-transaction", saveTransaction)

//*saving new transaction
router.post("/save-transaction-admin-dashboard", saveTransactionAdmin)

//*saving new transaction
router.post("/save-transaction-template-no-regular-user", saveTransactionTemplateForNoRegularUser)

//*saving new transaction
router.post("/transaction", getListOfAllSavedTransaction)

//*update transaction
router.patch("/update-transaction/:id", updateTransaction)

//*remove duplicate entry in transaction document
router.delete("/remove-duplicate-transaction/:id", removeDuplicateEntry)

module.exports = router;
