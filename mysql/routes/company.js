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
  runNamedInventoryQuery,
  returnEventDevicesToWarehouse,
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
const { listCompanyLocations } = require("../controllers/location");
const { optionalJWT } = require("../../middlewares/optionalJWT");
const { isStaffSession } = require("../../helpers/consumerUserFilter");
const logger = require("../../helpers/logger");
const router = Router();
router.use(require('express').json());

// ─── Denegar por defecto (FedRAMP P1.1 · AC-3, 2026-10-21) ───────────────────
//
// Todo /api/db_company exige sesión de staff salvo PUBLIC_ROUTES, registradas
// antes del router.use. test/defaultDenyRouters.test.js lo comprueba.
//
// - industry: la lista de sectores para el formulario de registro. Pública.
// - consulting-company y new_company: el registro de compañía del dashboard
//   (pages/authentication) puede llamarlas antes de tener sesión. Sin sesión
//   pasan por DB_COMPANY_PUBLIC_MODE: `warn` (por defecto) las deja pasar y
//   las registra; `enforce` responde 401. Pasar a enforce cuando el log
//   confirme que nadie las usa sin sesión.
const PUBLIC_ROUTES = ["POST /industry", "POST /consulting-company", "POST /new_company"];

const publicMode = () => String(process.env.DB_COMPANY_PUBLIC_MODE || "warn").toLowerCase();

// Sin sesión, consulting-company solo busca por id o nombre (lo único que
// manda el registro).
const ANONYMOUS_FILTERS = { "/consulting-company": new Set(["company_id", "company_name"]) };

const registrationLane = async (req, res, next) => {
  try {
    if (await isStaffSession(req)) return next();
  } catch {
    // sin poder comprobar la sesión, se trata como anónima
  }
  if (publicMode() === "enforce") {
    return res.status(401).json({ ok: false, msg: "Authentication is required for this endpoint." });
  }
  const allowed = ANONYMOUS_FILTERS[req.path];
  if (allowed) {
    const keys = Object.keys(req.body ?? {});
    if (keys.length === 0 || keys.some((k) => !allowed.has(k))) {
      return res.status(400).json({ ok: false, msg: "Filter by company_id or company_name." });
    }
  }
  logger.warn("db_company: anonymous registration call allowed (DB_COMPANY_PUBLIC_MODE=warn)", {
    route: req.path,
    origin: req.header?.("origin"),
    ip: req.ip,
  });
  return next();
};

// Check industry column from company table
router.post("/industry", consultingIndustryCompanyTable);

// Check company info
router.post("/consulting-company", optionalJWT, registrationLane, consultingCompany);

// Insert new company
router.post("/new_company", optionalJWT, registrationLane, insertingCompany);

router.use(validateJWT, checkTokenVersion);

// Check company table
router.post("/companies_information", consultingCompanyTable);

// update company data
router.post("/update_company", authorizePermission("company", "update"), updateCompanyData);

//retrieve company inventory based on params
router.post("/retrieve-company-inventory", retrieveCompanyInventoryBasedOnParams);

// Delete company — mapea :id a company_id para que authorizePermission lo encuentre
router.delete(
  "/:id",
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
// OBSOLETA a favor de POST /api/db_item/inventory-page. Iba sin token y su
// handler caía a `WHERE 1=1` con el body vacío, así que paginaba item_inv de
// TODAS las compañías. El scope ahora lo impone el controlador.
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
router.post(
  "/company-inventory-with-current-warehouse-status",
  retrieveCompanyInventory
);

//insert new single item in company inventory
router.post("/insert-new-single-item", insertingItem);

//checking current inventory state of company inventory
router.get("/current-inventory/:company_id", checkingInventoryCurrentState);

//get inventory company based on location and sublocation
router.post("/get-inventory-company", getGroupedItemInventory);

//consulting company inventory based on submitted parameters
router.post(
  "/inventory-based-on-submitted-parameters",
  consultingCompanyInventoryBasedOnSubmittedParameters
);

// Replacement for the route above: the client names a catalog entry instead of
// sending SQL. Mounted on all three routers so call sites can migrate without
// also changing which namespace they post to.
router.post(
  "/inventory-query",
  runNamedInventoryQuery
);

// Return event devices to the warehouse atomically. Replaces three separate
// raw-SQL calls (UPDATE warehouse / SELECT ids / DELETE assignments) that were
// three independent transactions.
router.post(
  "/return-event-devices",
  returnEventDevicesToWarehouse
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
  getInventoryHierarchyWithTypes
);

//getting data from search parameter
router.post("/get-grouped-inventory-by-search-parameter", getGroupedInventoryBySearchParameter);

//suppliers info items
router.post("/filter-suppliers-info-items", filterSuppliersInfoItems);

//bulk delete items
// Misma cadena que su gemela de mysql/routes/item.js:107. Iba sin middleware, y
// desde 61edc32 (2026-07-20, "enforce can_* write flags on bulk/queue item
// ops") el controller exige `request.sqlStaffId` para resolver el scope de
// borrado. Ese commit toco el controller pero no las rutas, asi que esta quedo
// atras: sin validateJWT no hay sqlStaffId, getStaffCompanyAccess devuelve null
// y respondia 403 "Staff record not found for this company" a TODA llamada.
router.post("/delete-bulk-items", authorizePermission("inventory", "delete"), deleteBulkItems);

//checking item info
router.post("/check-item", checkingItem);

//retrieve company items with locations
router.post("/retrieve-company-items-with-locations", retrieveCompanyInventory);

// ─── Categories ──────────────────────────────────────────────────────────────
router.post("/categories", authorizePermission("inventory", "read"), listCompanyCategories);
router.post("/locations", authorizePermission("inventory", "read"), listCompanyLocations);
router.post("/categories/upsert", authorizePermission("inventory", "create"), upsertCategory);
router.delete("/categories/:category_id", authorizePermission("inventory", "delete"), deleteCategory);

// ─── Groups ──────────────────────────────────────────────────────────────────
router.post("/groups", authorizePermission("inventory", "read"), listCompanyGroups);
router.post("/groups/upsert", authorizePermission("inventory", "create"), upsertGroup);
router.delete("/groups/:group_id", authorizePermission("inventory", "delete"), deleteGroup);

// ─── Inventory grouped with sub-levels (new — does not affect existing endpoints)
router.post(
  "/company-inventory-grouped-full",
  getInventoryGroupedFull,
);

module.exports = router;
module.exports.PUBLIC_ROUTES = PUBLIC_ROUTES;
