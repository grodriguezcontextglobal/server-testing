/**
 * Company Route
 * host + /api/db_company
 */

const { Router } = require("express");
const {
  consultingCompany,
  consultingCompanyTable,
  insertingCompany,
  deleteCompany,
  consultingIndustryCompanyTable,
  updateCompanyData,
  updateGroupItems,
} = require("../controllers/company");
const {
  returningLeasedEquipmentToCompany,
  searchingInventoryTracking,
  searchingGetInventoryTracking,
  checkInventoryCompanyExists,
  updateContentInContainerItem,
  consultingCompanyInventoryWithPagination,
  consultingCompanyInventoryBasedOnLocationAndSubLocation,
  retrieveItemData,
  retrieveCompanyInventory,
} = require("../controllers/item");
const router = Router();

// Check company info
router.post("/consulting-company", consultingCompany);

// Check company table
router.post("/companies_information", consultingCompanyTable);

// Check industry column from company table
router.post("/industry", consultingIndustryCompanyTable);

// Insert new company
router.post("/new_company", insertingCompany);

// update company data
router.post("/update_company", updateCompanyData);

// Delete company
router.delete("/:id", deleteCompany);

//retuning leased equipment to original company
router.post("/returning-leased-equipment", returningLeasedEquipmentToCompany);

router.post("/update-group-items", updateGroupItems);

//searching function
router.post("/search-inventory", searchingInventoryTracking);

//searching function
router.get("/search-inventory", searchingGetInventoryTracking);

//check if company has inventory or not
router.get("/check-company-exists", checkInventoryCompanyExists);

//update item content in container
router.post("/update-content-in-container", updateContentInContainerItem);

//company inventory pagination
router.post(
  "/company-inventory-pagination",
  consultingCompanyInventoryWithPagination
);

//company inventory based on location and sublocation
router.post(
  "/inventory-based-on-location-and-sublocation",
  consultingCompanyInventoryBasedOnLocationAndSubLocation
);

//company inventory structure to be displayed in inventory page.
router.post("/company-inventory-structure", retrieveItemData);

//company inventory with current warehouse status
router.post("/company-inventory-with-current-warehouse-status", retrieveCompanyInventory);

module.exports = router;
