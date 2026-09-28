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

// Crea una locación para la compañía que diga el body. Antes anónima: bastaba
// alcanzar el host para sembrar locaciones en cualquier inquilino.
// authorizePermission contrasta ese company_id contra company_staff, así que
// deja de ser una afirmación. Las dos llamadas vivas del dashboard
// (CreateLocationModal y verifyLocationBeforeCreateNewInventory) ya mandan
// company_id en el body y x-token por el interceptor, así que no cambian.
router.post(
  "/locations",
  validateJWT,
  checkTokenVersion,
  authorizePermission("location", "create"),
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

// Reasigna en bloque la locación de N items. El controlador ya acota por
// compañía en las dos sentencias (el SELECT de la locación y el UPDATE de
// item_inv), así que no había cruce de inquilinos por id; lo que faltaba era
// autenticar al que dice ser de esa compañía. Resource inventory, no location:
// lo que se escribe son filas de item_inv.
router.put(
  "/locations/:id/inventory",
  validateJWT,
  checkTokenVersion,
  authorizePermission("inventory", "update"),
  [
    check("item_ids", "Item IDs array is required").isArray(),
    check("company_id", "Company ID is required").not().isEmpty(),
    validateFields,
  ],
  bulkAssignInventory
);

router.get("/companies/:id/locations", validateJWT, getCompanyLocations);

router.post("/companies/:id/locations", validateJWT, getCompanyLocations);

// Devuelve el árbol completo de locaciones y sub-locaciones de una compañía.
// Era anónimo: la estructura interna de cualquier inquilino a quien la pidiera.
// El parámetro pasa de :id a :company_id para que readCompanyId lo encuentre
// —la URL es la misma— y los controladores aceptan ambos nombres.
router.get(
  "/companies/:company_id/locations/tree",
  validateJWT,
  checkTokenVersion,
  authorizePermission("location", "read"),
  getCompanyLocationTree
);

// Escritura sobre la estructura de locaciones, antes anónima: cualquiera que
// alcanzara el host podía crear rutas de sub-locación en la compañía que
// dijera. El controlador ya comprueba que location_id pertenezca a company_id,
// así que no había cruce de inquilinos por id — lo que faltaba era que el
// company_id del body dejara de ser una afirmación. authorizePermission lo
// contrasta contra company_staff del llamante autenticado.
//
// location:create lo tienen root_admin/admin/sale_manager, inventory_manager e
// inventory_location_manager; inventory_location_assistant se queda en
// read/update, que es la línea que ya aplica el borrado hermano.
router.post(
  "/sub-location-path",
  validateJWT,
  checkTokenVersion,
  authorizePermission("location", "create"),
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

router.get(
  "/companies/:company_id/location-paths-tree",
  validateJWT,
  checkTokenVersion,
  authorizePermission("location", "read"),
  getLocationPathsTree
);

module.exports = router;
