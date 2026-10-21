/**
 * Auth Route
 * host + /api/db_item
 */
const express = require("express");
const { validateJWT } = require("../../middlewares/validate-jwt");
const {
  getInventoryPage,
  getInventoryFacets,
  suggestSerials,
} = require("../controllers/inventoryPage");
const { postInventoryExport } = require("../controllers/inventoryExport");
const { postInventoryImport } = require("../controllers/inventoryImport");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");
const {
  consultingItem,
  consultingItemTable,
  insertingItem,
  deleteItem,
  updateItemInTable,
  consultingInventoryTracking,
  consultingItemInWarehouseTable,
  updateItemInWarehouseAfterBeingAddedToEvent,
  insertBulkItem,
  searchingInventoryTracking,
  checkingItem,
  searchingGetInventoryTracking,
  fragmentData,
  gettingDataFromLocationOption,
  returningItemToStockWhenEventIsFinishedRefactored,
  checkingIfCompanyHasInventory,
  retrieveItemLocationQuantityForEvent,
  consultingCompanyInventoryWithPagination,
  consultingCompanyInventoryBasedOnLocationAndSubLocation,
  consultingCompanyInventoryBasedOnSubmittedParameters,
  runNamedInventoryQuery,
  returnEventDevicesToWarehouse,
  insertBulkItemAlhpanumericFormat,
  getGroupedItemInventory,
  // insertContainerItems,
  deleteBulkItems,
  retrieveItemData,
  deleteBulkItemBasedOnCriteria,
} = require("../controllers/item");
const {
  consultingInventoryCurrentState,
  consultingInventoryInEvent,
  consultingRowInItemInvAssignedEventTable,
  checkingInventoryCurrentState,
  updateEventItemShipping,
  getEventItemShipping,
  removeEventItemShipping,
  bulkUpdateEventItemShipping
} = require("../controllers/items_events");
const router = express.Router();

// ─── Denegar por defecto (FedRAMP P1.1 · AC-3, 2026-10-21) ───────────────────
//
// Todo /api/db_item exige sesión de staff. 16 rutas respondían sin sesión,
// entre ellas el envío de equipos de evento (PUT/DELETE /event-items) y la
// devolución al almacén. El dashboard las llama siempre con sesión
// (clasificación del 2026-10-14) y ni la app del consumidor ni el servidor las
// usan. Una ruta pública nueva iría en PUBLIC_ROUTES, antes del router.use.
// test/defaultDenyRouters.test.js lo comprueba.
const PUBLIC_ROUTES = [];
router.use(validateJWT, checkTokenVersion);

router.put("/event-items", updateEventItemShipping);
router.post("/event-items/search", getEventItemShipping);
router.delete("/event-items", removeEventItemShipping);
router.put("/event-items/bulk-update", bulkUpdateEventItemShipping);

//delete items in bulk way based on criteria
router.post("/delete-bulk-items-criteria", authorizePermission("inventory", "delete"), deleteBulkItemBasedOnCriteria);

// ✅ Force body parsing to ensure JSON bodies are read
router.use(express.json());

//check item info
// Anónima hasta el 2026-10-19: devolvía inventario de cualquier compañía. Solo la
// llama el dashboard, desde páginas con sesión.
router.post("/consulting-item", consultingItem);

//check item in warehouse
router.post("/warehouse-items", consultingItemInWarehouseTable);

// Página de inventario servida desde el servidor: una página de la tabla, y los
// agregados que llenan los filtros sin descargar el inventario entero.
//
// OJO CON EL ORDEN: tienen que quedar por ENCIMA del `router.post("/:id")` de
// más abajo. Ese catch-all captura cualquier POST de un solo segmento, y hoy ya
// deja sin efecto a catorce rutas registradas después que él —entre ellas
// /inventory-query y /inventory-pagination—, que acaban en `deleteItem`.
router.post("/inventory-page", getInventoryPage);
router.post("/inventory-facets", getInventoryFacets);
router.get("/serial-suggest", suggestSerials);

// Export del inventario completo, en cola: responde 202 + jobId y el fichero se
// recoge por `GET /api/jobs/owned/:jobId`. Mismo cuerpo que /inventory-page sin
// paginación, así que exporta EXACTAMENTE lo que la tabla está enseñando.
// Va aquí arriba por lo mismo que las tres de encima: el catch-all /:id.
router.post("/inventory-export", postInventoryExport);

// Import de una hoja de calculo entera: una fila por unidad, en UNA peticion.
// El endpoint por grupos (/bulk-item-alphanumeric) necesita 499 peticiones para
// un fichero de 500 unidades, contra un limite de 300 cada 15 minutos.
// Tambien aqui arriba por el catch-all /:id.
router.post("/bulk-item-from-spreadsheet", postInventoryImport);

//check table
// Devuelve el inventario de la compañía. Antes iba sin token y filtraba por el
// NOMBRE de la compañía tomado del body; ahora exige JWT y usa el company_id
// verificado. Queda obsoleta a favor de /inventory-page.
router.post("/items_information", consultingItemTable);

//check inventory current state by query
// Anónima y con SQL armado desde las claves del body hasta el 2026-10-19
// (FedRAMP S1.11). Ningún frontend la llama.
router.post("/current-inventory", consultingInventoryCurrentState);

//check inventory current state by query
router.post("/inventory_event/:id", consultingInventoryInEvent);

//track item history
router.post("/tracking_item/:id", consultingInventoryTracking);

//insert new item
router.post("/new_item", authorizePermission("inventory", "create"), insertingItem);

//insert bulk item
router.post("/bulk-item", authorizePermission("inventory", "create"), insertBulkItem);

//insert bulk item alpha numeric format
router.post("/bulk-item-alphanumeric", authorizePermission("inventory", "create"), insertBulkItemAlhpanumericFormat);

//update new item
router.post("/edit-item", authorizePermission("inventory", "update"), updateItemInTable);

//updating item in inv after being added to event set up
// Previously ungated. Gated to match the other inventory writes: the event-
// assignment roles (sale_manager L2, event_manager L3) already hold
// inventory:update, so this does not lock them out; scope is enforced in the
// controller. Clients must now send the JWT to this endpoint (frontend coordination).
router.post("/item-out-warehouse", authorizePermission("inventory", "update"), updateItemInWarehouseAfterBeingAddedToEvent);

//updateItemInWarehouseAfterBeingAddedToEvent
// Borrar un ítem. El parámetro está acotado a DÍGITOS a propósito.
//
// Sin `(\\d+)` esto captura cualquier POST de un solo segmento y deja sin efecto
// a las catorce rutas registradas después —comprobado recorriendo el stack del
// router—, que acaban todas en `deleteItem`. Once tenían gemelo vivo en otro
// prefijo (/api/db_company, /api/db_event) y por eso nada parecía roto; tres no:
// /consulting-row-item-assigned-event, /inventory-pagination y /retrieve-item-data.
//
// Y había un filo peor que el enrutado: `deleteItem` lee item_id y company_id
// del BODY e ignora `req.params.id`, así que cualquier petición a una de esas
// rutas que llevara los dos campos borraba ese ítem.
//
// El handler no usa el parámetro; esta ruta es un duplicado de /delete-item.
// Se puede borrar del todo cuando las métricas confirmen que nadie llama a la
// forma numérica.
router.post("/:id(\\d+)", authorizePermission("inventory", "delete"), deleteItem);

//delete item in inventory
router.post("/delete-item", authorizePermission("inventory", "delete"), deleteItem);

//bulk delete items
router.post("/delete-bulk-items", authorizePermission("inventory", "delete"), deleteBulkItems);

//consulting item inv assigned event table
router.post(
  "/consulting-row-item-assigned-event",
  consultingRowInItemInvAssignedEventTable
);

//searching function
router.post("/search-inventory", searchingInventoryTracking);

//searching inventory
router.get("/search-inventory", searchingGetInventoryTracking);

//get item info
router.post("/check-item", checkingItem);

//get current inventory state
router.get("/check-inventory/:company_id", checkingInventoryCurrentState);

//get fragment data
router.get("/fragment-data", fragmentData);

//get location and count data
router.get("/location-count", gettingDataFromLocationOption);

//returning item to stock after event finished (refactored)
router.post(
  "/returning-item-refactored",
  returningItemToStockWhenEventIsFinishedRefactored
);

//check if company has inventory
router.get("/check-company-has-inventory", checkingIfCompanyHasInventory);

//available inventory structured by location with its quantity
router.post(
  "/retrieve-item-location-quantity",
  retrieveItemLocationQuantityForEvent
);

//company inventory pagination
// OBSOLETA a favor de /inventory-page (arriba), que pagina con allowlist de
// filtros, hasMore y columnas explícitas. Se le añade el token porque al quitar
// la sombra del catch-all `/:id` esta ruta vuelve a ser alcanzable.
router.post("/inventory-pagination", consultingCompanyInventoryWithPagination);

//company inventory based on location and sublocation
router.post(
  "/inventory-based-on-location-and-sublocation",
  consultingCompanyInventoryBasedOnLocationAndSubLocation
);

// Consulting company inventory based on submitted parameters.
// This handler executes SQL supplied in the request body, so it MUST stay
// authenticated. It was reachable anonymously here (and on /api/db_event),
// while the identical /api/db_company route was gated — anyone on the internet
// could run arbitrary statements against production. Do not remove these.
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

//get inventory company based on location and sublocation
router.post("/get-inventory-company", getGroupedItemInventory);

router.post("/retrieve-item-data", retrieveItemData);

module.exports = router;
module.exports.PUBLIC_ROUTES = PUBLIC_ROUTES;
