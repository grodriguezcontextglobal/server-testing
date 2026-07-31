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
 * @param {(body: object) => (object|Promise<object|null>)} buildPayload
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

      const payload = await buildPayload(request.body);
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

/**
 * Factory para un controller que encola el trabajo pesado pero, a diferencia
 * de `createQueuedJobController`, espera INTERNAMENTE a que el job termine
 * (polling corto al documento Job) antes de responder — para que, en el caso
 * típico, el cliente reciba exactamente la misma forma de respuesta que
 * antes de migrar a cola (sin cambio de contrato). Solo si el job no termina
 * dentro de `maxWaitMs` cae al contrato async (202 + jobId).
 *
 * Pensado para el worker DEDICADO de poll rápido (ver
 * project_bulk_queue_migration_plan.md) — con el worker genérico
 * (QUEUE_POLL_MS=4000 por default) esta espera agregaría 2-4s a CADA
 * llamada, incluso las triviales.
 *
 * @param {string} type
 * @param {(body: object) => (object|Promise<object>)} buildPayload
 * @param {object} [opts]
 * @param {(body: object) => object|null} [opts.validate]
 * @param {(body: object) => string} [opts.idempotencyKeyFn]
 * @param {number} [opts.syncStatus=200]              Status cuando termina a tiempo.
 * @param {(result: any) => object} [opts.buildSyncBody] Cuerpo cuando termina a tiempo (default: el `result` tal cual).
 * @param {number} [opts.failedStatus=500]            Status cuando el job termina en failed/dead dentro de la espera.
 * @param {(job: object) => object} [opts.buildFailedBody]
 * @param {(job: object) => object} [opts.buildTimeoutBody] Cuerpo del fallback 202 si se agota `maxWaitMs`.
 * @param {number} [opts.maxWaitMs=4000]
 * @param {number} [opts.pollIntervalMs=150]
 * @param {Function} [opts.enqueueFn]
 * @param {Function} [opts.extractContextFn]
 * @param {Function} [opts.sleepFn]        Inyectable para tests deterministas (sin timers reales).
 * @param {Function} [opts.nowFn]          Inyectable para tests deterministas (default: Date.now).
 * @param {object} [opts.JobModel]         Inyectable para tests (default: models/Job.js).
 */
function createSyncOrQueuedController(
  type,
  buildPayload,
  {
    validate,
    idempotencyKeyFn,
    syncStatus = 200,
    buildSyncBody = (result) => result,
    failedStatus = 500,
    buildFailedBody = (job) => ({ ok: false, msg: job.lastError || "Job failed" }),
    buildTimeoutBody = (job) => ({
      ok: true,
      jobId: job.id,
      msg: "Request queued — still processing. Poll GET /api/jobs/owned/:jobId for the result.",
    }),
    maxWaitMs = 4000,
    pollIntervalMs = 150,
    nowFn = () => Date.now(),
    enqueueFn = enqueue,
    extractContextFn = extractJobContext,
    logger = defaultLogger,
    sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    JobModel,
  } = {}
) {
  const Job = JobModel || require("../models/Job");

  return async function syncOrQueuedController(request, response) {
    try {
      if (validate) {
        const rejection = validate(request.body);
        if (rejection) {
          return response.status(rejection.status).json(rejection.body);
        }
      }

      const payload = await buildPayload(request.body);
      const job = await enqueueFn(type, payload, {
        idempotencyKey: idempotencyKeyFn ? idempotencyKeyFn(request.body) : undefined,
        context: extractContextFn(request),
      });

      const deadline = nowFn() + maxWaitMs;
      let current = job;
      while (nowFn() < deadline) {
        if (current.status === "done") {
          return response.status(syncStatus).json(buildSyncBody(current.result));
        }
        if (current.status === "failed" || current.status === "dead") {
          return response.status(failedStatus).json(buildFailedBody(current));
        }
        await sleepFn(pollIntervalMs);
        current = await Job.findById(job.id).lean();
        if (!current) break; // no debería pasar; guarda contra un delete externo
      }

      return response.status(202).json(buildTimeoutBody(job));
    } catch (error) {
      logger.error(`syncOrQueuedController: failed for '${type}'`, { error: error.message });
      return response.status(500).json({ ok: false, message: error.message });
    }
  };
}

module.exports = { createQueuedJobController, createSyncOrQueuedController };
