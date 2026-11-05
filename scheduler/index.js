'use strict';

/**
 * Scheduled jobs bootstrap. Wired from index.js inside the single-instance guard
 * (isNativeMaster || isPM2FirstInstance) so only one cluster worker runs the
 * cron timers. Enqueued work is still idempotent, so a double-fire is harmless.
 *
 * Uses node-schedule (already a dependency). Cron is in the server's local time.
 */
const schedule = require("node-schedule");
const logger = require("../helpers/logger");
const { runOverdueReminders } = require("./overdueReminders");
const { runExpireConsents } = require("./consentExpiry");
const { sendHeartbeat } = require("../helpers/heartbeat");

/**
 * Corre una tarea diaria y late al terminar — el latido es lo que convierte
 * esto en un *dead-man switch*.
 *
 * QUÉ PROBLEMA RESUELVE, que hoy no tiene solución: si estos cron dejan de
 * dispararse —porque el proceso dueño murió, porque nadie quedó como "primera
 * instancia", porque el servicio no arrancó— **no hay nada que lo note**. No
 * hay error, no hay log, no hay 500: simplemente no pasa nada, y se descubre
 * cuando un colegio pregunta por qué no le llegaron los recordatorios. Con el
 * latido, el monitor espera algo más de 24 h y avisa cuando no llega.
 *
 * `force: true` a propósito: son una vez al día, así que el freno del intervalo
 * mínimo no pinta nada aquí y solo podría comerse el único latido del día.
 *
 * El latido va en `finally` porque un fallo también es información — se manda
 * `down` con el mensaje, y así el canal de alertas distingue "falló" de "no
 * corrió", que se arreglan de forma muy distinta.
 */
const runWithHeartbeat = async (name, label, run) => {
  try {
    const result = await run();
    logger.info(`[scheduler] ${label}: ${JSON.stringify(result)}`);
    sendHeartbeat(name, { status: "up", msg: JSON.stringify(result), force: true }).catch(() => {});
  } catch (error) {
    logger.error(`[scheduler] ${label} failed: ${error.message}`);
    sendHeartbeat(name, { status: "down", msg: error.message, force: true }).catch(() => {});
  }
};

const initScheduledJobs = () => {
  const jobs = [];

  // Overdue-device reminder (school track) — 08:00 hora del Este (EST/EDT),
  // no la del servidor. Corre a diario; isReminderDay decide a quien le toca.
  jobs.push(
    schedule.scheduleJob({ rule: "0 8 * * *", tz: "America/New_York" }, () =>
      runWithHeartbeat("scheduler_overdue", "overdue-reminders", runOverdueReminders)
    )
  );

  // Daily consent-OTC expiry sweep (school track) — 00:05 server time.
  jobs.push(
    schedule.scheduleJob("5 0 * * *", () =>
      runWithHeartbeat("scheduler_consent", "consent-expiry", runExpireConsents)
    )
  );

  logger.info("[scheduler] initialized: overdue-reminders (daily 08:00 America/New_York), consent-expiry (daily 00:05)");
  return jobs;
};

module.exports = { initScheduledJobs, runWithHeartbeat };
