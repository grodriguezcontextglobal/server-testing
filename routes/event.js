/**
 * Auth Route
 * host + /api/event
 */

const { Router } = require("express");
const router = Router();
const {
  createEvent,
  eventList,
  editSubscriptionEvent,
  editEvent,
  searchStaffAllEvents,
  gettingEventListPerCompany,
  eventStaffDetailInfo,
  inventoryEventBasedOnPeriod,
  deleteEvent,
  updateLargeNumberOfEventsAtOnce,
  updateGlobalStateOfEvent,
  updateEventInventoryFreshestData,
} = require("../controller/event");
const { getListOfUsersAndTransactionsPerEvent } = require("../controller/auth");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { optionalJWT } = require("../middlewares/optionalJWT");
const { isStaffOrigin, isStaffSession } = require("../helpers/consumerUserFilter");
const { isValidObjectId } = require("mongoose");

// ─── Denegar por defecto (FedRAMP P1.1 · AC-3, 2026-10-21) ───────────────────
//
// Todo /api/event exige sesión de staff salvo PUBLIC_ROUTES, registradas antes
// del router.use. test/defaultDenyRouters.test.js lo comprueba.
//
// Única ruta pública: la app del consumidor (app.devitrak.net, sin login) carga
// el evento con POST /event-list { _id } (Home, DeviceSelection,
// AuthenticationLogin). El dashboard la llama con sesión (Login.jsx, después de
// guardar el token).
const PUBLIC_ROUTES = ["POST /event-list"];

// Dos carriles. Con sesión de staff, como siempre. Desde el dashboard sin
// sesión, 401. Sin sesión desde otro origen, solo un evento por su _id: antes
// era `Event.find(body)` y un body vacío devolvía todos los eventos de todas las
// compañías, con sus listas de staff.
const eventListLanes = async (req, res, next) => {
  try {
    if (await isStaffSession(req)) return next();
  } catch {
    // sin poder comprobar la sesión, se trata como anónima
  }
  if (isStaffOrigin(req)) {
    return res.status(401).json({ ok: false, msg: "Authentication is required for this endpoint." });
  }
  const id = req.body?._id;
  if (typeof id !== "string" || !isValidObjectId(id)) {
    return res.status(400).json({ ok: false, msg: "_id is required." });
  }
  req.body = { _id: id };
  return next();
};

//display event by parameters
router.post("/event-list", optionalJWT, eventListLanes, eventList);

router.use(validateJWT, checkTokenVersion);

// create an event
router.post("/create-event", createEvent);

//edit event
router.put("/edit-event/:id", editSubscriptionEvent);

//edit/update a specific value of an event
router.patch("/edit-event/:id", editSubscriptionEvent);

//edit staff event
router.patch("/edit-staff-event/:id", editEvent);

//display event list
router.get("/event-list", eventList);


//event list per company
router.get("/event-list-per-company", gettingEventListPerCompany);

router.post("/staff-all-events", searchStaffAllEvents);

//all consumers and transactions per event
// Solo dashboard: lista consumidores y transacciones de un evento.
router.get(
  "/all-users-and-transactions-per-event",
  getListOfUsersAndTransactionsPerEvent
);

//retrieve staff info in detail of an event
router.get("/event-staff-detail/:id", eventStaffDetailInfo);

//check event inventory based on timeframe selected
router.get("/event-inventory-based-on-period", inventoryEventBasedOnPeriod);

// delete event
router.delete("/delete-event/:id", deleteEvent);

//update large number of events at once
router.patch("/update-events", updateLargeNumberOfEventsAtOnce);

router.post("/update-global-state", updateGlobalStateOfEvent)

router.post("/update-event-inventory-freshest-data", updateEventInventoryFreshestData)

module.exports = router;
module.exports.PUBLIC_ROUTES = PUBLIC_ROUTES;
