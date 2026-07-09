'use strict';

const Job = require("../models/Job");

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

// Todos los status posibles del schema (models/Job.js) — se listan explícitamente
// para que buildStatsFromRows rellene con 0 los que no tuvieron ninguna fila,
// en vez de omitirlos silenciosamente del reporte.
const JOB_STATUSES = ["pending", "processing", "done", "failed", "dead"];

/** Formato de detalle de un job para depuración (admin-only, ver requireSuperUser). */
function buildJobStatusResponse(job) {
  return {
    ok: true,
    id: job.id,
    type: job.type,
    status: job.status,
    payload: job.payload,
    context: job.context,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    result: job.result,
    nextAttemptAt: job.nextAttemptAt,
    lockedBy: job.lockedBy,
    lockedAt: job.lockedAt,
    doneAt: job.doneAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/** Convierte las filas de un $group por status en un objeto con todos los status en 0 salvo los presentes. */
function buildStatsFromRows(rows) {
  const stats = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0]));
  let total = 0;

  for (const row of rows) {
    stats[row._id] = row.count;
    total += row.count;
  }

  stats.total = total;
  return stats;
}

/**
 * GET /api/jobs/:jobId — detalle de un job puntual.
 * findById se inyecta para testear sin Mongo; en producción usa Job.findById.
 */
function createGetJobStatus({ findById = (id) => Job.findById(id) } = {}) {
  return async function getJobStatus(request, response) {
    try {
      const { jobId } = request.params;

      if (!OBJECT_ID_REGEX.test(jobId)) {
        return response.status(400).json({ ok: false, msg: "Invalid jobId" });
      }

      const job = await findById(jobId);
      if (!job) {
        return response.status(404).json({ ok: false, msg: "Job not found" });
      }

      return response.status(200).json(buildJobStatusResponse(job));
    } catch (error) {
      return response.status(500).json({ ok: false, message: error.message });
    }
  };
}

/**
 * GET /api/jobs/stats — conteo agregado por status.
 * aggregateByStatus se inyecta para testear sin Mongo; en producción agrupa por status.
 */
function createGetJobStats({
  aggregateByStatus = () => Job.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
} = {}) {
  return async function getJobStats(request, response) {
    try {
      const rows = await aggregateByStatus();
      return response.status(200).json({ ok: true, stats: buildStatsFromRows(rows) });
    } catch (error) {
      return response.status(500).json({ ok: false, message: error.message });
    }
  };
}

/**
 * Respuesta SLIM para el dueño de un job (polling de su propia tarea, ej. la
 * subida de un documento). A diferencia de buildJobStatusResponse (super_user,
 * observabilidad), NO expone payload/context/lockedBy — el payload de un upload
 * tiene rutas internas de archivo y otros datos que el cliente no necesita.
 */
function buildOwnedJobResponse(job) {
  return {
    ok: true,
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    lastError: job.lastError,
    result: job.result,
  };
}

/**
 * GET /api/jobs/owned/:jobId — polling del DUEÑO del job (NO super_user).
 *
 * Endpoint ADITIVO: reutiliza validateJWT (ya integrado app-wide) sin tocar
 * requireSuperUser ni los endpoints de observabilidad del dashboard. Devuelve
 * el job solo si `context.uid === req.uid`. Un job ajeno o sin dueño responde
 * 404 (mismo que not-found) para no filtrar la existencia de jobs de otros.
 *
 * Prerrequisito: validateJWT corre antes (setea req.uid). El dueño se fija al
 * encolar (ej. controller/document.js usa created_by como uid del context).
 */
function createGetOwnedJobStatus({ findById = (id) => Job.findById(id) } = {}) {
  return async function getOwnedJobStatus(request, response) {
    try {
      if (!request.uid) {
        return response.status(401).json({ ok: false, msg: "Unauthorized" });
      }

      const { jobId } = request.params;
      if (!OBJECT_ID_REGEX.test(jobId)) {
        return response.status(400).json({ ok: false, msg: "Invalid jobId" });
      }

      const job = await findById(jobId);

      // 404 (no 403) si no existe, no tiene dueño, o es de otro usuario —
      // no revelar la existencia de jobs ajenos.
      if (!job || !job.context?.uid || String(job.context.uid) !== String(request.uid)) {
        return response.status(404).json({ ok: false, msg: "Job not found" });
      }

      return response.status(200).json(buildOwnedJobResponse(job));
    } catch (error) {
      return response.status(500).json({ ok: false, message: error.message });
    }
  };
}

// Instancias de producción (usan Job real) — lo que montan las rutas.
const getJobStatus = createGetJobStatus();
const getJobStats = createGetJobStats();
const getOwnedJobStatus = createGetOwnedJobStatus();

module.exports = {
  buildJobStatusResponse,
  buildStatsFromRows,
  buildOwnedJobResponse,
  createGetJobStatus,
  createGetJobStats,
  createGetOwnedJobStatus,
  getJobStatus,
  getJobStats,
  getOwnedJobStatus,
};
