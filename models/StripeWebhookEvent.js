const { Schema, model } = require("mongoose");

/**
 * Eventos de Stripe ya procesados por POST /api/webhooks/stripe (2026-11-06).
 * Stripe reintenta y puede mandar el mismo evento varias veces: el _id es el id
 * del evento, así que un duplicado choca con la clave única y se salta.
 *
 * Se guardan 90 días (Stripe deja de reintentar a los 3), y con ellos qué se
 * hizo, como evidencia de quién cambió un plan (AU-2).
 */
const StripeWebhookEventSchema = new Schema({
  _id: { type: String, required: true }, // evt_...
  type: { type: String, required: true },
  company: { type: Schema.Types.ObjectId, ref: "Company", default: null },
  outcome: { type: String, default: null }, // applied | ignored | stale | unknown_company
  processed_at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
});

module.exports = model("StripeWebhookEvent", StripeWebhookEventSchema);
