'use strict';

/**
 * Núcleo PURO de la cola de tareas (sin mongoose, sin I/O).
 *
 * Aquí vive toda la lógica de decisión y construcción de queries; el wiring a
 * MongoDB (models/Job.js, helpers/queue.js, queue/worker.js) solo aplica estas
 * funciones al cliente Mongoose. Mantenerlo puro permite testearlo sin DB, igual
 * que scripts/migrate* e idempotencyMutationCache.
 *
 * Todas las funciones que dependen del tiempo reciben `now` (epoch ms) explícito
 * para ser deterministas y testeables (no usan Date.now() internamente).
 */

const DEFAULTS = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 1000, // primer reintento ~1s
  maxDelayMs: 5 * 60 * 1000, // techo del backoff: 5 min
  lockTimeoutMs: 2 * 60 * 1000, // un 'processing' más viejo que esto se considera colgado
});

/**
 * Snapshot de auditoría/identidad para el job — NUNCA credenciales crudas.
 *
 * Cuando el worker ejecuta el job más tarde, el `req` original (y sus headers
 * x-token, s-token-lq, x-company-id, ...) ya no existe. buildContext captura la
 * IDENTIDAD YA VERIFICADA por el middleware de auth de esa request (req.uid,
 * req.sqlStaffId, el companyId ya resuelto) — no el token en sí.
 *
 * Es un ALLOWLIST estricto a propósito: solo estos 3 campos salen de aquí, así
 * que aunque una llamada pase un token por error, se descarta silenciosamente
 * en vez de terminar persistido en la colección `jobs`.
 *
 * Para agregar un campo nuevo en el futuro (ver DESIGN_task_queue.md): añadirlo
 * aquí explícitamente, nunca hacer spread de headers/objetos completos.
 */
function buildContext(source = {}) {
  const { uid = null, companyId = null, sqlStaffId = null } = source || {};
  return { uid, companyId, sqlStaffId };
}

/**
 * Documento a insertar al encolar. status=pending y nextAttemptAt=now para que
 * el worker lo tome en el próximo ciclo.
 *
 * IMPORTANTE: si no hay idempotencyKey, el campo se OMITE (no se pone en null).
 * El índice `unique + sparse` de idempotencyKey NO ignora los valores `null`
 * PRESENTES — sparse solo omite el campo AUSENTE. Escribir null haría que solo
 * un job sin clave pudiera existir (el 2do daría E11000 dup key {idempotencyKey:
 * null}). Dejando el campo ausente, el índice sparse lo ignora de verdad y
 * pueden coexistir infinitos jobs sin clave.
 */
function buildNewJob({ type, payload, idempotencyKey, maxAttempts = DEFAULTS.maxAttempts, context }, now) {
  const job = {
    type,
    payload,
    status: 'pending',
    attempts: 0,
    maxAttempts,
    nextAttemptAt: new Date(now),
    lockedBy: null,
    lockedAt: null,
    lastError: null,
    result: null,
    doneAt: null,
    context: buildContext(context),
  };
  if (idempotencyKey) job.idempotencyKey = idempotencyKey;
  return job;
}

/**
 * Backoff exponencial con techo: base * 2^(attempts-1), acotado a maxDelayMs.
 * `attempts` es el número de intentos YA realizados (>=1).
 */
function computeBackoffMs(attempts, { baseDelayMs, maxDelayMs } = DEFAULTS) {
  const exp = baseDelayMs * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(exp, maxDelayMs);
}

/** Update para un job que se procesó con éxito. Libera el lock. */
function applySuccess(job, result, now) {
  return {
    status: 'done',
    doneAt: new Date(now),
    result: result ?? null,
    lastError: null,
    lockedBy: null,
    lockedAt: null,
  };
}

/**
 * Update para un job que falló. Incrementa attempts y decide:
 *  - si aún quedan intentos → vuelve a pending con nextAttemptAt = now + backoff
 *  - si se agotaron → dead (dead-letter, requiere intervención manual)
 * En ambos casos libera el lock.
 */
function applyFailure(job, errorMessage, now, opts = DEFAULTS) {
  const attempts = (job.attempts || 0) + 1;
  const base = {
    attempts,
    lastError: errorMessage,
    lockedBy: null,
    lockedAt: null,
  };

  if (attempts >= opts.maxAttempts) {
    return { ...base, status: 'dead' };
  }

  return {
    ...base,
    status: 'pending',
    nextAttemptAt: new Date(now + computeBackoffMs(attempts, opts)),
  };
}

/** ¿Es un job 'processing' cuyo lock expiró (el worker murió a mitad)? */
function isStale(job, now, lockTimeoutMs = DEFAULTS.lockTimeoutMs) {
  if (job.status !== 'processing' || !job.lockedAt) return false;
  return now - new Date(job.lockedAt).getTime() > lockTimeoutMs;
}

/** Filtro del claim: pending cuyo nextAttemptAt ya venció. */
function buildClaimFilter(now) {
  return { status: 'pending', nextAttemptAt: { $lte: new Date(now) } };
}

/** Update del claim: sella el job como processing para este worker. */
function buildClaimUpdate(workerId, now) {
  return { $set: { status: 'processing', lockedBy: workerId, lockedAt: new Date(now) } };
}

/** Filtro del barrido de recuperación: processing con lock más viejo que el timeout. */
function buildRecoveryFilter(now, lockTimeoutMs = DEFAULTS.lockTimeoutMs) {
  return { status: 'processing', lockedAt: { $lte: new Date(now - lockTimeoutMs) } };
}

/** Update del barrido: devuelve el job a pending y libera el lock. */
function buildRecoveryUpdate(now) {
  return { $set: { status: 'pending', lockedBy: null, lockedAt: null, nextAttemptAt: new Date(now) } };
}

/** Reconoce el error de clave duplicada de Mongo (job ya encolado con esa idempotencyKey). */
function isDuplicateKeyError(err) {
  return !!err && (err.code === 11000 || err.code === 11001);
}

module.exports = {
  DEFAULTS,
  buildNewJob,
  buildContext,
  computeBackoffMs,
  applySuccess,
  applyFailure,
  isStale,
  buildClaimFilter,
  buildClaimUpdate,
  buildRecoveryFilter,
  buildRecoveryUpdate,
  isDuplicateKeyError,
};
