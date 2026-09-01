'use strict';

const { createQueuedJobController } = require("../helpers/queuedController");
const { resolveBranding, applyBrandedEnvelope } = require("./branding");

/**
 * Especialización de createQueuedJobController para 'send-email': reemplaza el
 * patrón repetido de este archivo ("armar msg + sgMail.send + responder") por
 * "armar msg + enqueue + responder 202". La composición del HTML sigue siendo
 * síncrona (buildMessage, PURA); lo único que se difiere es la llamada de red a
 * SendGrid, que ahora la hace el worker (queue/handlers/email.js) y sobrevive
 * una caída del proveedor o del servidor. Ver DESIGN_task_queue.md § Fase 1.
 *
 * `branded: true` marks a notification a client sends on their own behalf — a
 * return receipt to a guardian, a contract to sign, a deposit refund. The
 * controller resolves that client's branding from the payload before building,
 * hands it to buildMessage as a second argument, and stamps the from-name and
 * Reply-To onto the finished message. buildMessage stays pure and synchronous,
 * so every existing unit test that calls one directly still gets a plain object
 * back — unbranded, which is exactly the Devitrak default.
 *
 * Emails that genuinely come from Devitrak — password resets, platform alerts,
 * internal ops — leave the flag off and keep Devitrak's identity.
 *
 * @param {(body: object, branding?: object) => object} buildMessage  Compone {to, from, subject, html} desde request.body.
 * @param {object} [opts]
 * @param {boolean} [opts.branded]  Resolver la marca del cliente antes de componer.
 * @param {(body: object) => string} [opts.idempotencyKeyFn] Si el email tiene una entidad natural
 *   (ej. una factura), devuelve la clave para deduplicar reintentos. Sin ella, se aceptan duplicados.
 * @param {Function} [opts.enqueueFn]         Inyectable en tests.
 * @param {Function} [opts.extractContextFn]  Inyectable en tests.
 * @param {Function} [opts.resolveBrandingFn] Inyectable en tests.
 */
function createQueuedEmailController(buildMessage, opts = {}) {
  const { branded = false, resolveBrandingFn = resolveBranding, ...rest } = opts;

  const buildPayload = branded
    ? async (body, request) => {
        const branding = await resolveBrandingFn(body, { request });
        return applyBrandedEnvelope(buildMessage(body, branding), branding);
      }
    : buildMessage;

  return createQueuedJobController("send-email", buildPayload, {
    buildSuccessBody: (job) => ({ ok: true, notification: "Email queued", jobId: job.id }),
    ...rest,
  });
}

module.exports = { createQueuedEmailController };
