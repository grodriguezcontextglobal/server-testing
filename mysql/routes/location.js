const { Router } = require("express");
const { check } = require("express-validator");
const validateFields = require("../../middlewares/validate-field");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");
const {
  createLocation,
  bulkAssignInventory,
  getCompanyLocations,
  getCompanyLocationTree,
  deleteLocation,
  resolveLocationCompanyId,
} = require("../controllers/location");
const {
  createSubLocationPath,
  getLocationPathsTree,
  deleteSubLocationPath,
} = require("../controllers/sub_location_paths");

const router = Router();

router.post(
  "/locations",
  [
    check("company_id", "Company ID is required").not().isEmpty(),
    check("location_name", "Location name is required").not().isEmpty(),
    validateFields,
  ],
  createLocation
);

// Hard DELETE, and it was anonymous: no token, and the statement was
// `WHERE location_id = ?` with no company clause, so anyone who could reach the
// host could delete any company's location by id. During an audit an automated
// caller did exactly that to location_id = 1 on production.
//
// resolveLocationCompanyId runs first because this route names its resource by
// id alone — see the note on that middleware for why the owning company is read
// from the row rather than from the caller. The dashboard's only call site
// (RenderingFilters.jsx) sends no body and no s-company-lq header, and needs no
// change: its axios interceptor already attaches x-token.
router.post(
  "/locations/:id",
  validateJWT,
  checkTokenVersion,
  resolveLocationCompanyId,
  authorizePermission("location", "delete"),
  deleteLocation
);

router.put(
  "/locations/:id/inventory",
  [
    check("item_ids", "Item IDs array is required").isArray(),
    check("company_id", "Company ID is required").not().isEmpty(),
    validateFields,
  ],
  bulkAssignInventory
);

router.get("/companies/:id/locations", validateJWT, getCompanyLocations);

router.post("/companies/:id/locations", validateJWT, getCompanyLocations);

router.get("/companies/:id/locations/tree", getCompanyLocationTree);

router.post(
  "/sub-location-path",
  [
    check("company_id", "company_id is required").not().isEmpty(),
    check("location_id", "location_id is required").not().isEmpty(),
    check("sub_location_path", "sub_location_path must be a non-empty array").isArray({ min: 1 }),
    validateFields,
  ],
  createSubLocationPath
);

// Destructive: drops the path and its whole descendant subtree. `company_id`
// still arrives in the body, but authorizePermission checks it against
// company_staff for the authenticated caller, so it is a parameter that has to
// be earned rather than a claim that is taken at face value. Without this the
// route deleted any company's sub-location tree for anyone who could reach the
// host. location:delete is held by root_admin/admin/sale_manager (full access),
// inventory_manager and inventory_location_manager; inventory_location_assistant
// has only read/update, which is the intent for a structural delete.
router.post(
  "/sub-location-path/delete",
  validateJWT,
  checkTokenVersion,
  authorizePermission("location", "delete"),
  [
    check("company_id", "company_id is required").not().isEmpty(),
    check("location_id", "location_id is required").not().isEmpty(),
    check("sub_location_path", "sub_location_path must be a non-empty array").isArray({ min: 1 }),
    validateFields,
  ],
  deleteSubLocationPath
);

router.get("/companies/:id/location-paths-tree", getLocationPathsTree);

module.exports = router;
