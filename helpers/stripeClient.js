'use strict';

const Stripe = require("stripe");
const { createCircuitBreaker } = require("./circuitBreaker");

// Endurecimiento de Stripe (Fase 3, DESIGN_task_queue.md § Fase 3): las
// mutaciones NO se encolan (el dinero no se buffea) — se endurecen aquí, en la
// capa de cliente, sin cambiar el contrato del frontend.

// Retry idempotente del SDK: Stripe reintenta automáticamente los fallos de red
// / 409 / 5xx y agrega/reutiliza idempotency keys en los reintentos, así que es
// seguro (no duplica cobros). Configurable por env, default 2.
// Fallback placeholder solo para que el módulo cargue en tests/entornos sin la
// key (nunca se llama a Stripe real ahí). En producción STRIPE_SECRET_KEY está
// seteada. Mismo criterio tolerante que el resto del repo (ej. sgMail).
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
  maxNetworkRetries: Number(process.env.STRIPE_MAX_NETWORK_RETRIES) || 2,
});

// Solo los errores de INFRAESTRUCTURA de Stripe deben abrir el circuito. Un
// card_error (tarjeta rechazada) o invalid_request_error (bug nuestro) es una
// respuesta exitosa de Stripe — prueba que está sano, no debe abrir el circuito
// ni bloquear otros cobros sanos. Un error sin `type` (ej. timeout de red crudo,
// no envuelto por el SDK) se trata como infra por las dudas.
const STRIPE_INFRA_ERROR_TYPES = new Set([
  "api_connection_error",
  "api_error",
  "rate_limit_error",
]);

function isStripeInfraFailure(error) {
  if (!error || !error.type) return true; // error crudo/desconocido → asumir infra
  return STRIPE_INFRA_ERROR_TYPES.has(error.type);
}

// Un solo breaker COMPARTIDO por todas las mutaciones de Stripe: si Stripe está
// caído, todas fallan rápido en vez de colgar el request layer con reintentos.
const stripeBreaker = createCircuitBreaker((fn) => fn(), {
  failureThreshold: Number(process.env.STRIPE_BREAKER_THRESHOLD) || 5,
  cooldownMs: Number(process.env.STRIPE_BREAKER_COOLDOWN_MS) || 30_000,
  isFailure: isStripeInfraFailure,
});

/**
 * Envuelve un thunk que hace una mutación de Stripe con el breaker compartido.
 * Uso: `await runStripeMutation(() => stripe.paymentIntents.capture(id, {...}))`.
 * breakerFn se inyecta para tests; en producción usa el breaker compartido.
 */
function createRunStripeMutation(breakerFn = stripeBreaker) {
  return (thunk) => breakerFn(thunk);
}

const runStripeMutation = createRunStripeMutation();

module.exports = {
  stripe,
  runStripeMutation,
  createRunStripeMutation,
  isStripeInfraFailure,
  __stripeBreaker: stripeBreaker,
};
