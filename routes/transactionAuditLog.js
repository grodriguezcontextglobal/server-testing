/**
 * Auth Route
 * host + /api/transaction-audit-log
 *
 * FedRAMP S0.1 / AU-9 (2026-10-19). Las dos rutas iban sin ningún middleware:
 * cualquiera podía escribir entradas y leer el log entero de todas las compañías.
 *
 * - POST /create-audit: RETIRADA. La escribía solo el cliente (el dashboard dejó
 *   de llamarla en dff5fc21) y sin autor; el audit trail del servidor
 *   (middlewares/auditTrail.js) ya registra cada escritura con quién la hizo, y
 *   un log de auditoría no puede aceptar entradas desde fuera.
 * - GET /audit-log: solo super_user de plataforma, porque mezcla todas las
 *   compañías. Ningún frontend la llama.
 */

const { Router } = require("express");
const router = Router();

const { displayTransactionAuditLog } = require("../controller/transactionAuditLog");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { requireSuperUser } = require("../middlewares/requireSuperUser");

//display all events in audit log
router.get("/audit-log", validateJWT, checkTokenVersion, requireSuperUser, displayTransactionAuditLog)

module.exports = router;
