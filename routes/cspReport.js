'use strict';

/**
 * POST /api/csp-report: buzón de violaciones de la CSP del dashboard (SI-4,
 * CM-7). El dashboard la pone en `report-uri` / `Reporting-Endpoints`; la
 * llama el navegador por su cuenta, sin sesión y sin preflight.
 *
 * SE MONTA ANTES DEL MIDDLEWARE GLOBAL (index.js, junto a routes/health):
 *   - Limitador global: no. Cada página con una violación manda un informe; no
 *     pueden gastar el cupo de 300/15 min de la IP de los usuarios. Lleva el
 *     suyo, por IP, y al pasarse descarta en silencio.
 *   - auditTrail: no. Una escritura anónima por informe inundaría
 *     StaffActivityLog.
 *   - express.json global: no lee estos content types. Lleva su propio parser
 *     de 16 kb.
 *
 * Responde 204 SIEMPRE, también ante un cuerpo roto, demasiado grande o un
 * fallo de Mongo: el remitente es un navegador y no hace nada con el error.
 *
 * Para leerlos: node scripts/summarize-csp-reports.js --days 7
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requestMetrics } = require('../middlewares/requestMetrics');
const { normalizeCspReports } = require('../helpers/cspReport');
const logger = require('../helpers/logger');

const CSP_REPORT_TYPES = ['application/csp-report', 'application/reports+json', 'application/json'];
const parser = express.json({ type: CSP_REPORT_TYPES, limit: '16kb', strict: false });

const noContent = (_req, res) => res.status(204).end();

// Un parser que no puede fallar: cuerpo roto o > 16 kb = informe descartado.
const parseOrDrop = (req, res, next) => parser(req, res, (err) => (err ? noContent(req, res) : next()));

const limiter = rateLimit({
  windowMs: Number(process.env.CSP_REPORT_RATE_WINDOW_MS || 60_000),
  limit: Number(process.env.CSP_REPORT_RATE_MAX || 60),
  standardHeaders: false,
  legacyHeaders: false,
  handler: noContent,
});

function createCspReportHandler({ model = () => require('../models/CspReport') } = {}) {
  return async (req, res) => {
    try {
      const docs = normalizeCspReports(req.body, req.headers['user-agent']);
      if (docs.length > 0) await model().insertMany(docs, { ordered: false });
    } catch (error) {
      logger.warn('CSP report could not be stored', { error: error.message });
    }
    return noContent(req, res);
  };
}

const router = express.Router();
router.post('/api/csp-report', requestMetrics, limiter, parseOrDrop, createCspReportHandler());

module.exports = router;
module.exports.createCspReportHandler = createCspReportHandler;
