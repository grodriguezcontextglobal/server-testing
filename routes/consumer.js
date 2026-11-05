/**
 * Consumer Public Route
 * host + /api/consumer
 *
 * Namespace público para la app de consumer (attendees). Estas rutas NO exigen
 * token: reutilizan controllers ya existentes y aplican `optionalJWT` (no
 * bloquea; solo detecta el token si viene, para telemetría / futuro dual-lane).
 *
 * Motivación: el hardening de permisos en /api/stripe y /api/admin dejó rutas
 * que el consumer necesita detrás de validateJWT + authorizeMongoPermission,
 * provocando 401 en un flujo que es público por diseño. Este namespace aísla
 * el contrato público del consumer para que futuros hardenings del admin no lo
 * vuelvan a romper.
 */

const { Router } = require("express");
const { consumerTokenGate } = require("../middlewares/consumerTokenGate");
const router = Router();

const { optionalJWT } = require("../middlewares/optionalJWT");
const { listAllCustomers, stripeCustomer } = require("../controller/stripe");
const { showAllUsers } = require("../controller/auth");

// Buscar customer de Stripe por email  → { ok, stripeCustomerSaved: [...] }
// Reemplaza el bloqueado POST /api/stripe/customers (billing:read).
router.post(
  "/stripe/find-customer",
  optionalJWT,
  consumerTokenGate({ subject: (req) => ({ email: req.body?.email }) }),
  listAllCustomers
);

// Crear customer de Stripe → { ok, id, fullName, ... }
// Reemplaza el roto POST /api/stripe/create-account (doble /api + ruta inexistente).
router.post("/stripe/create-customer", optionalJWT, stripeCustomer);

// Lista de usuarios (equivalente público del GET /api/admin/users → showAllUsers).
router.get("/users", optionalJWT, showAllUsers);
router.post("/users", optionalJWT, showAllUsers);

module.exports = router;
