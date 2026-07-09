'use strict';

// API de encolado que usan los controllers. Ver DESIGN_task_queue.md.
const Job = require("../models/Job");
const { buildNewJob, isDuplicateKeyError } = require("../queue/core");
const logger = require("./logger");

/**
 * Extrae del request la identidad YA VERIFICADA por el middleware de auth que
 * corrió antes (validateJWT/optionalJWT/authorizeMongoPermission), para dejarla
 * como snapshot de auditoría en el job. Nunca lee ni reenvía el token crudo
 * (x-token, s-token-lq) — solo lo que esos middlewares ya validaron y colgaron
 * en `req`. La resolución de companyId sigue el mismo orden de precedencia que
 * authorizeMongoPermission.js (header x-company-id, luego params/body/query).
 *
 * Llamar ANTES de responder/perder el req, típicamente en el propio controller
 * justo antes de enqueue(). buildContext (queue/core.js) igual lo sanea con un
 * allowlist, así que esta función puede ser generosa sin riesgo de fuga.
 */
const extractJobContext = (req) => {
  const headerCompanyId =
    (typeof req.header === "function" ? req.header("x-company-id") : undefined) ||
    req.headers?.["x-company-id"];

  return {
    uid: req.uid ?? null,
    companyId: headerCompanyId || req.body?.company_id || req.params?.company_id || req.query?.company_id || null,
    sqlStaffId: req.sqlStaffId ?? null,
  };
};

/**
 * Encola una tarea para procesamiento asíncrono durable.
 *
 * @param {string} type              Tipo de handler (ej. 'send-email:invoice').
 * @param {object} payload           Args que recibirá el handler.
 * @param {object} [opts]
 * @param {string} [opts.idempotencyKey] Si ya existe un job con esta clave, no duplica: devuelve el existente.
 * @param {number} [opts.maxAttempts]    Override del máximo de reintentos.
 * @param {object} [opts.context]        Snapshot de identidad (ver extractJobContext). Se sanea con allowlist.
 * @returns {Promise<object>} el documento Job (nuevo o el ya existente).
 */
const enqueue = async (type, payload, { idempotencyKey, maxAttempts, context } = {}) => {
  const now = Date.now();
  const doc = buildNewJob({ type, payload, idempotencyKey, maxAttempts, context }, now);

  try {
    return await Job.create(doc);
  } catch (err) {
    // Choque de idempotencyKey → el job ya estaba encolado. No es error.
    if (isDuplicateKeyError(err) && idempotencyKey) {
      logger.info(`enqueue: job ya encolado (idempotencyKey=${idempotencyKey}), se reusa el existente`);
      return Job.findOne({ idempotencyKey });
    }
    throw err;
  }
};

module.exports = { enqueue, extractJobContext };
