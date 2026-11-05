'use strict';

/**
 * Standalone entry point to run the task-queue worker as its OWN process — a
 * native nssm service on Windows Server 2019 (see DEPLOY.md § Split services).
 *
 * The main Node server (index.js) keeps an in-process worker for every type
 * EXCEPT the ones a dedicated worker owns. The type lists live in
 * constants/queueTypeGroups.js, so each service is configured by GROUP:
 *   DevitrakEmailWorker  : QUEUE_GROUP=email
 *   DevitrakBulkWorker   : QUEUE_GROUP=bulk    QUEUE_POLL_MS=300
 *   DevitrakDeleteWorker : QUEUE_GROUP=delete  QUEUE_POLL_MS=300
 *   DevitrakHeavyWorker  : QUEUE_GROUP=heavy   (poll normal: nadie espera)
 * Los tres ultimos los instala scripts/install-queue-workers.ps1.
 *   DevitrakServer (main): QUEUE_EXCLUDE_GROUPS=dedicated
 * The older explicit form (QUEUE_TYPES / QUEUE_EXCLUDE_TYPES) still works and
 * takes precedence.
 *
 * The atomic claim + type filter (queue/core.js buildClaimFilter) guarantees no
 * double-processing across the two workers. The open Mongo connection keeps the
 * process alive even though the worker's poll timer is unref'd.
 */
require("dotenv").config({ quiet: true });
const logger = require("../helpers/logger");
const { dbConnection } = require("../database/config");
const worker = require("./worker");

const shutdown = (signal) => {
  logger.info(`[queue-standalone] ${signal} received — stopping worker`);
  try {
    worker.stop();
  } finally {
    process.exit(0);
  }
};

(async () => {
  try {
    await dbConnection();
    logger.info("[queue-standalone] MongoDB connected");
  } catch (error) {
    logger.error(`[queue-standalone] MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }

  worker.start();
  logger.info("[queue-standalone] task queue worker started");
  require("../helpers/runtimeMetrics").startRuntimeMetrics();

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) =>
    logger.error(`[queue-standalone] uncaughtException: ${err.message}`)
  );
  process.on("unhandledRejection", (reason) =>
    logger.error(`[queue-standalone] unhandledRejection: ${reason && reason.message ? reason.message : reason}`)
  );
})();
