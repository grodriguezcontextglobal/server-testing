'use strict';

/**
 * POST /api/webhooks/stripe (2026-11-06). La lógica en controller/stripeWebhook.js.
 *
 * SE MONTA ANTES DEL MIDDLEWARE GLOBAL (index.js, junto a routes/cspReport):
 *   - express.json global: no. La firma de Stripe se verifica sobre el cuerpo
 *     CRUDO; un JSON reparseado ya no cuadra. Lleva express.raw.
 *   - Limitador global: no. Stripe manda ráfagas desde pocas IPs (un cambio de
 *     plan son 3-4 eventos) y un 429 solo provoca reintentos. Lleva uno propio,
 *     amplio.
 *   - Sesión: no hay; lo que autentica es la firma.
 *   - auditTrail: no. Los cambios de plan se registran como PLAN_CHANGE con el
 *     id del evento (controller/stripeWebhook.js).
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requestMetrics } = require('../middlewares/requestMetrics');
const { createStripeWebhookHandler } = require('../controller/stripeWebhook');

const WEBHOOK_PATH = '/api/webhooks/stripe';

const limiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.STRIPE_WEBHOOK_RATE_MAX || 300),
  standardHeaders: false,
  legacyHeaders: false,
});

const router = express.Router();
router.post(
  WEBHOOK_PATH,
  requestMetrics,
  limiter,
  express.raw({ type: 'application/json', limit: '1mb' }),
  createStripeWebhookHandler()
);

module.exports = router;
module.exports.WEBHOOK_PATH = WEBHOOK_PATH;
