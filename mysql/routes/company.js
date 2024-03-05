/**
 * Company Route
 * host + /api/db_company
 */

const { Router } = require("express");
const { consultingCompany, consultingCompanyTable, insertingCompany, deleteCompany, consultingIndustryCompanyTable } = require("../controllers/company");
const router = Router();

// Check company info
router.post("/consulting-company", consultingCompany);

// Check company table
router.post('/companies_information', consultingCompanyTable);

// Check industry column from company table
router.post('/industry', consultingIndustryCompanyTable);

// Insert new company
router.post('/new_company', insertingCompany);

// Delete company
router.delete('/:id', deleteCompany);

module.exports = router;
