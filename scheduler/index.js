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

const initScheduledJobs = () => {
  const jobs = [];

  // Daily overdue-device reminder (school track) — 08:00 server time.
  jobs.push(
    schedule.scheduleJob("0 8 * * *", async () => {
      try {
        const result = await runOverdueReminders();
        logger.info(`[scheduler] overdue-reminders: ${JSON.stringify(result)}`);
      } catch (error) {
        logger.error(`[scheduler] overdue-reminders failed: ${error.message}`);
      }
    })
  );

  // Daily consent-OTC expiry sweep (school track) — 00:05 server time.
  jobs.push(
    schedule.scheduleJob("5 0 * * *", async () => {
      try {
        const result = await runExpireConsents();
        logger.info(`[scheduler] consent-expiry: ${JSON.stringify(result)}`);
      } catch (error) {
        logger.error(`[scheduler] consent-expiry failed: ${error.message}`);
      }
    })
  );

  logger.info("[scheduler] initialized: overdue-reminders (daily 08:00), consent-expiry (daily 00:05)");
  return jobs;
};

module.exports = { initScheduledJobs };
