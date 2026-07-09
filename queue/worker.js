'use strict';

/**
 * Worker/dispatcher de la cola de tareas.
 *
 * IMPORTANTE: debe correr en UNA sola instancia. Se arranca desde index.js bajo
 * `isNativeMaster || isPM2FirstInstance` para que el cluster `pm2 -i max` no lo
 * duplique. El claim atómico (findOneAndUpdate) protege igual ante dobles tomas.
 *
 * Ver DESIGN_task_queue.md.
 */

const Job = require("../models/Job");
const logger = require("../helpers/logger");
const core = require("./core");
const { getHandler } = require("./handlers");

const WORKER_ID = `${process.pid}`;
const POLL_MS = Number(process.env.QUEUE_POLL_MS) || 4000;
const BATCH = Number(process.env.QUEUE_BATCH) || 20; // máx jobs por ciclo

let timer = null;
let running = false; // evita solapamiento de ticks

// Opciones de reintento por job (respeta su maxAttempts propio).
function jobOpts(job) {
  return { ...core.DEFAULTS, maxAttempts: job.maxAttempts || core.DEFAULTS.maxAttempts };
}

// Reclama atómicamente un job listo. Devuelve el doc o null si no hay.
async function claimOne() {
  const now = Date.now();
  return Job.findOneAndUpdate(
    core.buildClaimFilter(now),
    core.buildClaimUpdate(WORKER_ID, now),
    { sort: { nextAttemptAt: 1 }, new: true }
  );
}

// Ejecuta un job ya reclamado y persiste el resultado (done / reintento / dead).
async function processJob(job) {
  const handler = getHandler(job.type);

  if (!handler) {
    const upd = core.applyFailure(job, `No hay handler para type='${job.type}'`, Date.now(), jobOpts(job));
    await Job.updateOne({ _id: job._id }, upd);
    logger.warn(`queue: sin handler para '${job.type}' (job ${job._id})`);
    return;
  }

  try {
    const result = await handler(job.payload, job);
    await Job.updateOne({ _id: job._id }, core.applySuccess(job, result, Date.now()));
  } catch (err) {
    const upd = core.applyFailure(job, err.message, Date.now(), jobOpts(job));
    await Job.updateOne({ _id: job._id }, upd);
    if (upd.status === "dead") {
      logger.error(`queue: job ${job._id} (${job.type}) a dead-letter tras ${upd.attempts} intentos: ${err.message}`);
    } else {
      logger.warn(`queue: job ${job._id} (${job.type}) falló (intento ${upd.attempts}), reintenta: ${err.message}`);
    }
  }
}

// Devuelve a 'pending' los 'processing' colgados (worker murió a mitad).
async function recoverStale() {
  const now = Date.now();
  const res = await Job.updateMany(
    core.buildRecoveryFilter(now),
    core.buildRecoveryUpdate(now)
  );
  const n = res.modifiedCount || 0;
  if (n > 0) logger.warn(`queue: recuperados ${n} job(s) 'processing' colgados`);
}

// Un ciclo: drena hasta BATCH jobs listos.
async function tick() {
  if (running) return;
  running = true;
  try {
    let processed = 0;
    let job;
    while (processed < BATCH && (job = await claimOne())) {
      await processJob(job);
      processed++;
    }
  } catch (err) {
    logger.error("queue: error en tick", { error: err.message });
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return; // ya arrancado
  logger.info(`Task queue worker starting (id=${WORKER_ID}, poll=${POLL_MS}ms, batch=${BATCH})`);
  // Al arrancar, recuperar cualquier colgado de una caída previa.
  recoverStale().catch((err) => logger.error("queue: recoverStale falló", { error: err.message }));
  timer = setInterval(tick, POLL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, tick, processJob, claimOne, recoverStale, WORKER_ID };
