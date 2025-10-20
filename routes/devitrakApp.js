/**
 * Auth Route
 * host + /api/devitrak
 */

const { Router } = require("express");
const { acceptancePoliciesAndTermsApp, updateAcceptanceByAddingStaffMemberID } = require("../controller/devitrakApp");
const router = Router();

//create new devitrak app
router.post("/new_acceptance", acceptancePoliciesAndTermsApp);

//add new staff member id to existing acceptance
router.patch("/:id", updateAcceptanceByAddingStaffMemberID);

module.exports = router;
