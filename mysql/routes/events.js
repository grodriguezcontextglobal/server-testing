/**
 * Auth Route
 * host + /api/db_event
 */

const { Router } = require("express");
const {
  consultingEventInformation,
  insertingEvent,
  updateEventInfo,
  consultingEventTable,
  deleteEvent,
  insertingStaffInEvent,
  consultingEventsPerCompany,
  consultingInventoryEvent,
  updateStatusItemBasedOnEvent,
} = require("../controllers/events");
const {
  insertingItemInEvent,
  consultingInventoryInEvent,
  deletingItemsInEventAfterDeviceInventoryIsUpdated,
  insertingDeviceInEventDirectly,
  insertingDeviceInEventDirectlyFromContainer,
  allocateDeviceToEvent,
  allocateDeviceMarkedAsContainerInEvent,
  lockItemsForEvent,
  reserveItemsInInventoryForEvent,
  removeReservedItemsInInventoryForEvent,
} = require("../controllers/items_events");
const {
  returningItemToStockWhenEventIsFinished,
  itemFinalStatusWhenEventIsFinished,
  returningItemToStockWhenEventIsFinishedRefactored,
  itemFinalStatusWhenEventIsFinishedRefactored,
  updateItemInTableAfterBeingAddedToEventFromContainer,
  retrieveItemLocationQuantityForEvent,
  consultItemDataFromSerialNumber,
  getGroupedItemInventory,
  getGroupedItemWithFormatInventory,
  consultingCompanyInventoryBasedOnSubmittedParameters,
  runNamedInventoryQuery,
  returnEventDevicesToWarehouse,
  confirmItemsReturnedToStock,
} = require("../controllers/item");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");
const { reconcileEventCount, closeEventCount } = require("../controllers/eventCount");
const router = Router();

// ─── Denegar por defecto (FedRAMP P1.1 · AC-3, 2026-10-21) ───────────────────
//
// Todo /api/db_event exige sesión de staff. 23 de sus rutas respondían sin
// sesión, entre ellas crear y editar eventos, meter y sacar equipos y cerrar el
// evento. Nadie las llama sin sesión: el dashboard siempre con sesión
// (clasificación del 2026-10-14; events_information desde Login.jsx va después
// de guardar el token), y ni la app del consumidor ni el servidor las usan.
// Una ruta pública nueva tendría que ir en PUBLIC_ROUTES, registrada antes del
// router.use. test/eventRouterGuards.test.js lo comprueba.
const PUBLIC_ROUTES = [];
router.use(validateJWT, checkTokenVersion);

//check event info
router.post("/consulting-event", consultingEventInformation);

//consulting event
router.post("/events_information", consultingEventTable);

//consulting all events per company
router.post("/events_company", consultingEventsPerCompany);

//insert new event
router.post("/new_event", insertingEvent);

//update event info
router.post("/update-event/:event_id", updateEventInfo);

//insert new staff in event
router.post("/event_staff", insertingStaffInEvent);

//insert new devices in event
router.post("/event_device", insertingItemInEvent);

//insert new devices in event directly
router.post("/event_device_directly", insertingDeviceInEventDirectly);

//consulting inventory in event
router.post("/event-inventory/:id", consultingInventoryInEvent);

//returning item to stock after event finished
router.post("/returning-item", returningItemToStockWhenEventIsFinished);

//returning item to stock after event finished (refactored)
router.post(
  "/returning-item-refactored",
  returningItemToStockWhenEventIsFinishedRefactored,
);

router.post("/confirm-item-return", confirmItemsReturnedToStock);

//set final status of device when event finished
router.post("/device-final-status", itemFinalStatusWhenEventIsFinished);

//set final status of device when event finished (refactored)
router.post(
  "/device-final-status-refactored",
  itemFinalStatusWhenEventIsFinishedRefactored,
);
//delete event
router.delete("/:id", authorizePermission("event", "delete"), deleteEvent);

//consulting all inventory in event
router.get("/event-inventory/:id", consultingInventoryEvent);

//consulting all inventory in event
router.post(
  "/remove-item-inventory-event",
  deletingItemsInEventAfterDeviceInventoryIsUpdated,
);

//update status of item based on event
router.post("/update-status-item-based-on-event", updateStatusItemBasedOnEvent);

//update item in table after being added to event from container
router.post(
  "/update-item-in-table-after-being-added-to-event-from-container",
  updateItemInTableAfterBeingAddedToEventFromContainer,
);

//inserting items in event from container item
// Era anónima. Además del hueco obvio (INSERT al evento sin sesión), sin
// validateJWT el job encolado queda SIN DUEÑO (context.uid = null), y entonces
// GET /api/jobs/owned/:jobId devuelve 404 para el jobId que este endpoint
// acaba de entregar — el cliente no podía consultar su propio trabajo.
router.post(
  "/inserting-items-in-event-from-container",
  insertingDeviceInEventDirectlyFromContainer,
);

//retrieve inventory structured by location with its quantity
router.post(
  "/retrieve-item-location-quantity",
  retrieveItemLocationQuantityForEvent,
);

//retrieve inventory structured by location with its quantity full details
router.post(
  "/retrieve-item-location-quantity-full-details",
  consultItemDataFromSerialNumber,
);

//retrieve inventory structured by item group with its location and its quantity
// event_manager permission required — used only on the event inventory selection page
router.post(
  "/retrieve-item-group-location-quantity",
  authorizePermission("event", "read"),
  getGroupedItemInventory,
);

//retrieve inventory structured by item group with its location and its quantity and more columns defined
router.post(
  "/retrieve-item-group-quantity-with-format",
  getGroupedItemWithFormatInventory,
);

// Consulting company inventory based on submitted parameters.
// This handler executes SQL supplied in the request body, so it MUST stay
// authenticated. It was reachable anonymously here (and on /api/db_item),
// while the identical /api/db_company route was gated — anyone on the internet
// could run arbitrary statements against production. Do not remove these.
router.post(
  "/inventory-based-on-submitted-parameters",
  consultingCompanyInventoryBasedOnSubmittedParameters,
);

// Replacement for the route above: the client names a catalog entry instead of
// sending SQL. Mounted on all three routers so call sites can migrate without
// also changing which namespace they post to.
router.post(
  "/inventory-query",
  runNamedInventoryQuery,
);

// Return event devices to the warehouse atomically. Replaces three separate
// raw-SQL calls (UPDATE warehouse / SELECT ids / DELETE assignments) that were
// three independent transactions.
router.post(
  "/return-event-devices",
  returnEventDevicesToWarehouse,
);

//allocate
router.post("/allocate-device-event", authorizePermission("event", "update"), allocateDeviceToEvent);

// Variante de contenedor de /allocate-device-event, y era anónima mientras la
// otra ya estaba gateada: hace UPDATE item_inv + INSERT al evento sobre los
// item_id que expande del contenedor. Falta todavía el
// authorizePermission("event", "update") que sí lleva su hermana — se dejó
// fuera a propósito para no convertir esto en un 403 sorpresa para staff sin
// ese permiso; decisión pendiente.
router.post(
  "/allocate-device-container-event",
  allocateDeviceMarkedAsContainerInEvent,
);

//reserve items in inventory for event
// event_manager permission required — updates event state (reserve = event:update)
router.post(
  "/reserve-items-for-event",
  authorizePermission("event", "update"),
  reserveItemsInInventoryForEvent,
);

//remove reserved items in inventory for event
router.post("/remove-reserved-items-for-event", removeReservedItemsInInventoryForEvent);

//lock items to be used in event
router.post("/lock-items-for-event", lockItemsForEvent);

// ─── Conteo de cierre de evento por identificador (RFID / código de barras) ───
// Ver DESIGN_rfid_event_count.md § 8. Dos operaciones separadas a propósito:
// `reconcile` es solo lectura y repetible (el operador barre, ve qué falta, va a
// buscarlo y barre otra vez); `close` es la que escribe.
router.post(
  "/event-count/reconcile",
  authorizePermission("inventory", "read"),
  reconcileEventCount,
);

router.post(
  "/event-count/close",
  authorizePermission("inventory", "update"),
  closeEventCount,
);

module.exports = router;
module.exports.PUBLIC_ROUTES = PUBLIC_ROUTES;
