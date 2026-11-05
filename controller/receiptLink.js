'use strict';

/**
 * Recibo público con enlace firmado (2026-10-20). Ver helpers/receiptLinkToken.js.
 *
 *   POST /api/transaction/receipt-link   staff con sesión, pago de SU compañía
 *        body { paymentIntent } → { ok, token, expiresAt }
 *   GET  /api/transaction/receipt        público, token en ?rt= o en x-receipt-token
 *        → { ok, receipt } con lo justo para el recibo, sin datos de contacto
 *
 * Lo que ve quien escanea (decisión del 2026-10-20): estado del pago, importe,
 * dispositivos y evento. Ni email ni teléfono del consumidor.
 */

const { createReceiptLinkHandlers } = require('./receiptLinkHandlers');

module.exports = createReceiptLinkHandlers({
  Transaction: require('../models/Transaction'),
  Event: require('../models/Event'),
  logger: require('../helpers/logger'),
});
