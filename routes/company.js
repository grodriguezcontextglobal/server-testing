/**
 * Auth Route
 * host + /api/company
 */

const { Router } = require("express");
const {
  createCompany,
  updatingCompany,
  searchingCompany,
  getCompanyList,
  searchingGetCompanyInfo,
} = require("../controller/company");
const {
  createProviderCompany,
  updateProviderCompany,
  uploadProviderDocument,
  getProviderCompanies,
} = require("../controller/providerCompany");
const router = Router();

router.post("/new", createCompany);

router.patch("/update-company/:id", updatingCompany);

router.post("/search-company", searchingCompany);

router.get("/search-company", searchingGetCompanyInfo);

router.post("/companies", getCompanyList);

//providers company
// Create new provider company
router.post("/new_provider", createProviderCompany);

// Update existing provider company
router.patch("/update_provider/:id", updateProviderCompany);

// Upload document for provider company
router.post("/provider-upload-document/:id", uploadProviderDocument);

// Get provider companies
router.get("/provider-companies", getProviderCompanies);

module.exports = router;
