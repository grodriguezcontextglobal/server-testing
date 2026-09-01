'use strict';

const { enqueue, extractJobContext } = require("./queue");
const defaultLogger = require("./logger");

/**
 * Factory genérica para un controller Express que reemplaza "hacer el trabajo
 * inline + responder" por "armar el payload + enqueue + responder 202". El
 * trabajo real (enviar el correo, guardar el log) lo hace después el worker
 * (queue/handlers/), así que sobrevive una caída del servidor o de la
 * dependencia externa. Ver DESIGN_task_queue.md § Fase 1.
 *
 * Extraída de nodeMailer/queueEmail.js cuando apareció un segundo consumidor
 * real (los logs) — antes de eso, una sola función bastaba.
 *
 * @param {string} type                                    Type de job (ver queue/handlers/index.js).
 * @param {(body: object, request?: object) => (object|Promise<object|null>)} buildPayload
 *   Compone el payload del job desde request.body. Puede ser async (ej. una consulta a DB para
 *   armar la lista de destinatarios); sigue corriendo síncronamente en el controller, antes de
 *   enqueue — solo se difiere la llamada de red/DB del handler, no la composición. Si resuelve a
 *   `null`/`undefined` (ej. "no hay destinatarios"), NO se encola nada — se responde con
 *   `buildSkippedBody` directamente.
 * @param {object} [opts]
 * @param {(body: object) => object|null} [opts.validate] Validación de entrada que corre ANTES de
 *   enqueue. Si devuelve `{status, body}`, responde eso y NO encola (preserva los 400 existentes
 *   en vez de convertirlos en 500). Si devuelve null/undefined, sigue normalmente.
 * @param {(body: object) => string} [opts.idempotencyKeyFn] Clave de dedup si hay una entidad natural.
 * @param {(job: object) => object} [opts.buildSuccessBody]  Personaliza la respuesta 202 (default: {ok:true, jobId}).
 * @param {(body: object) => object} [opts.buildSkippedBody] Respuesta cuando buildPayload devuelve null (default: {ok:true}).
 * @param {Function} [opts.enqueueFn]
 * @param {Function} [opts.extractContextFn]
 */
function createQueuedJobController(
  type,
  buildPayload,
  {
    validate,
    idempotencyKeyFn,
    buildSuccessBody = (job) => ({ ok: true, jobId: job.id }),
    buildSkippedBody = () => ({ ok: true }),
    enqueueFn = enqueue,
    extractContextFn = extractJobContext,
    logger = defaultLogger,
  } = {}
) {
  return async function queuedJobController(request, response) {
    try {
      if (validate) {
        const rejection = validate(request.body);
        if (rejection) {
          return response.status(rejection.status).json(rejection.body);
        }
      }

      const payload = await buildPayload(request.body, request);
      if (payload == null) {
        return response.status(200).json(buildSkippedBody(request.body));
      }

      const job = await enqueueFn(type, payload, {
        idempotencyKey: idempotencyKeyFn ? idempotencyKeyFn(request.body) : undefined,
        context: extractContextFn(request),
      });

      return response.status(202).json(buildSuccessBody(job));
    } catch (error) {
      logger.error(`queuedJobController: failed to enqueue '${type}'`, { error: error.message });
      return response.status(500).json({
        ok: false,
        message: error.message,
      });
    }
  };
}

module.exports = { createQueuedJobController };
