'use strict';

const { createQueuedJobController } = require("../helpers/queuedController");

/**
 * Especialización de createQueuedJobController para 'send-email': reemplaza el
 * patrón repetido de este archivo ("armar msg + sgMail.send + responder") por
 * "armar msg + enqueue + responder 202". La composición del HTML sigue siendo
 * síncrona (buildMessage, PURA); lo único que se difiere es la llamada de red a
 * SendGrid, que ahora la hace el worker (queue/handlers/email.js) y sobrevive
 * una caída del proveedor o del servidor. Ver DESIGN_task_queue.md § Fase 1.
 *
 * @param {(body: object) => object} buildMessage  Compone {to, from, subject, html} desde request.body.
 * @param {object} [opts]
 * @param {(body: object) => string} [opts.idempotencyKeyFn] Si el email tiene una entidad natural
 *   (ej. una factura), devuelve la clave para deduplicar reintentos. Sin ella, se aceptan duplicados.
 * @param {Function} [opts.enqueueFn]         Inyectable en tests.
 * @param {Function} [opts.extractContextFn]  Inyectable en tests.
 */
function createQueuedEmailController(buildMessage, opts = {}) {
  return createQueuedJobController("send-email", buildMessage, {
    buildSuccessBody: (job) => ({ ok: true, notification: "Email queued", jobId: job.id }),
    ...opts,
  });
}

module.exports = { createQueuedEmailController };
