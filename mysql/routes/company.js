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
  insertingItem,
  checkingInventoryCurrentState,
  getGroupedItemInventory,
  consultingCompanyInventoryBasedOnSubmittedParameters,
  updateAllItemsInInventory,
  updateItemsBasedOnAlphanumericSerialNumber,
  updateItemsBasedOnSerialNumber,
  getInventoryHierarchyWithTypes,
  getGroupedInventoryBySearchParameter,
  filterSuppliersInfoItems,
  deleteBulkItems,
  checkingItem,
  retrieveCompanyInventoryBasedOnParams,
} = require("../controllers/item");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");
const {
  listCompanyCategories,
  upsertCategory,
  deleteCategory,
  listCompanyGroups,
  upsertGroup,
  deleteGroup,
  getInventoryGroupedFull,
} = require("../controllers/categories_groups");
const router = Router();
router.use(require('express').json());

// Check company info
router.post("/consulting-company", consultingCompany);

// Check company table
router.post("/companies_information", consultingCompanyTable);

// Check industry column from company table
router.post("/industry", consultingIndustryCompanyTable);

// Insert new company
router.post("/new_company", insertingCompany);

// update company data
router.post("/update_company", validateJWT, checkTokenVersion, authorizePermission("company", "update"), updateCompanyData);

//retrieve company inventory based on params
router.post("/retrieve-company-inventory", retrieveCompanyInventoryBasedOnParams);

// Delete company — mapea :id a company_id para que authorizePermission lo encuentre
router.delete(
  "/:id",
  validateJWT,
  checkTokenVersion,
  (req, _res, next) => { req.params.company_id = req.params.id; next(); },
  authorizePermission("company", "delete"),
  deleteCompany,
);

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
router.post("/company-inventory-structure", validateJWT, checkTokenVersion, retrieveItemData);

//company inventory with current warehouse status
router.post(
  "/company-inventory-with-current-warehouse-status",
  retrieveCompanyInventory
);

//insert new single item in company inventory
router.post("/insert-new-single-item", insertingItem);

//checking current inventory state of company inventory
router.get("/current-inventory/:company_id", validateJWT, checkTokenVersion, checkingInventoryCurrentState);

//get inventory company based on location and sublocation
router.post("/get-inventory-company", getGroupedItemInventory);

//consulting company inventory based on submitted parameters
router.post(
  "/inventory-based-on-submitted-parameters",
  validateJWT,
  checkTokenVersion,
  consultingCompanyInventoryBasedOnSubmittedParameters
);

//update all items in inventory company based on submitted parameters
router.post("/update-all-items-in-inventory", updateAllItemsInInventory);

//update all items in inventory company based on submitted parameters
router.post(
  "/update-items-based-on-alphanumeric-serial-number",
  updateItemsBasedOnAlphanumericSerialNumber
);

//update all items in inventory company based on submitted parameters
router.post(
  "/update-items-based-on-serial-number",
  updateItemsBasedOnSerialNumber
);

//get location/sub location and items type hierarchy
router.post(
  "/get-location-item-types-hierarchy",
  validateJWT,
  checkTokenVersion,
  getInventoryHierarchyWithTypes
);

//getting data from search parameter
router.post("/get-grouped-inventory-by-search-parameter", getGroupedInventoryBySearchParameter);

//suppliers info items
router.post("/filter-suppliers-info-items", filterSuppliersInfoItems);

//bulk delete items
router.post("/delete-bulk-items", deleteBulkItems);

//checking item info
router.post("/check-item", validateJWT, checkTokenVersion, checkingItem);

//retrieve company items with locations
router.post("/retrieve-company-items-with-locations", retrieveCompanyInventory);

// ─── Categories ──────────────────────────────────────────────────────────────
router.post("/categories", validateJWT, checkTokenVersion, listCompanyCategories);
router.post("/categories/upsert", validateJWT, checkTokenVersion, upsertCategory);
router.delete("/categories/:category_id", validateJWT, checkTokenVersion, deleteCategory);

// ─── Groups ──────────────────────────────────────────────────────────────────
router.post("/groups", validateJWT, checkTokenVersion, listCompanyGroups);
router.post("/groups/upsert", validateJWT, checkTokenVersion, upsertGroup);
router.delete("/groups/:group_id", validateJWT, checkTokenVersion, deleteGroup);

// ─── Inventory grouped with sub-levels (new — does not affect existing endpoints)
router.post(
  "/company-inventory-grouped-full",
  validateJWT,
  checkTokenVersion,
  getInventoryGroupedFull,
);

module.exports = router;
