/**
 * Identificadores escaneables de inventario (EPC RFID / código de barras).
 * host + /api/db_identifier
 *
 * Namespace propio, no colgado de /db_item, a propósito: mysql/routes/item.js:101
 * tiene un comodín `router.post("/:id")` que tapa toda ruta POST de un segmento
 * registrada después de esa línea. Registrar acá evita la trampa en vez de
 * esquivarla, y deja el namespace libre para el resto del trabajo de RFID.
 *
 * Ver DESIGN_rfid_event_count.md § 7.
 */
const express = require("express");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");
const {
  registerIdentifier,
  registerIdentifiersBulk,
  getIdentifiersByItems,
} = require("../controllers/identifier");

const router = express.Router();

// Escribir un identificador es escribir inventario: mismo permiso que editar un
// item. El scope por fila lo aplica el controlador con buildInventoryScopeFilter.
//
// La cadena va escrita entera en cada ruta, sin arrays compartidos con spread:
// scripts/extract-api-payloads.js resuelve los middlewares estáticamente y un
// `...canWrite` le deja la columna vacía en docs/api-payloads.md — que es
// justo donde el frontend mira para saber qué auth mandar.

//vincular un identificador a un item (o reclamar uno liberado)
router.post("/register", validateJWT, checkTokenVersion, authorizePermission("inventory", "update"), registerIdentifier);

//etiquetado por lote, con pre-flight de conflictos
router.post("/register-bulk", validateJWT, checkTokenVersion, authorizePermission("inventory", "update"), registerIdentifiersBulk);

//leer los identificadores activos de N items
router.post("/by-items", validateJWT, checkTokenVersion, authorizePermission("inventory", "read"), getIdentifiersByItems);

module.exports = router;
