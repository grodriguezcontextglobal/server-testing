const { Schema, model } = require("mongoose");

/**
 * Violaciones de la Content-Security-Policy del dashboard (SI-4, CM-7).
 * Las manda el navegador a POST /api/csp-report (routes/cspReport.js).
 *
 * Solo lo que hace falta para responder "qué se bloqueó en los últimos N
 * días": ni cookies ni cabeceras salvo el user agent. Se borran solas a los
 * 30 días (índice TTL sobre createdAt).
 */
const RETENTION_SECONDS = 60 * 60 * 24 * 30;

const CspReport = new Schema({
  documentUri: { type: String },
  violatedDirective: { type: String },
  effectiveDirective: { type: String },
  blockedUri: { type: String },
  sourceFile: { type: String },
  lineNumber: { type: Number },
  disposition: { type: String },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now, expires: RETENTION_SECONDS },
});

module.exports = model("CspReport", CspReport);
module.exports.RETENTION_SECONDS = RETENTION_SECONDS;
