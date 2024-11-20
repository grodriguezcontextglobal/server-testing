/**
 * Auth Route
 * host + /api/company
 */

const { Router } = require("express");
const { createCompany, updatingCompany, searchingCompany, getCompanyList, searchingGetCompanyInfo } = require("../controller/company");
const router = Router();

router.post('/new', createCompany)

router.patch('/update-company/:id', updatingCompany)

router.post('/search-company', searchingCompany)

router.get('/search-company', searchingGetCompanyInfo)

router.post('/companies', getCompanyList)

module.exports = router;
