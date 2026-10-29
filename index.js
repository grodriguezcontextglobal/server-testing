const express = require("express");
require("express-async-errors"); // Handle async errors automatically
const compression = require("compression");
const cors = require("cors");
const cluster = require("node:cluster");
const OS = require("node:os");
const helmet = require("helmet");
// const rateLimit = require("express-rate-limit");
const { dbConnection } = require("./database/config");

// Load environment variables
require("dotenv").config();

// Configuration imports
const { corsOptions } = require("./config/cors");
const { normalizeForwardedFor } = require("./middlewares/normalizeForwardedFor");
const {
  requestLogger,
  securityLogger,
} = require("./middlewares/requestLogger");
const { requestMetrics } = require("./middlewares/requestMetrics");
const { consumerTokenGate } = require("./middlewares/consumerTokenGate");
const { auditTrail } = require("./middlewares/auditTrail");
const metrics = require("./helpers/metrics");
const logger = require("./helpers/logger");

// Constants
const NUM_CPU = Math.min(OS.cpus().length, 4); // Limit to 4 workers to avoid resource exhaustion
const PORT = process.env.PORT;
// Loopback by default: IIS/the proxy on the same host is the only intended
// caller, so 34001 must not answer the network directly (SC-7). Containers set
// BIND_HOST=0.0.0.0 (see Dockerfile) so the published port still works.
const BIND_HOST = process.env.BIND_HOST || "127.0.0.1";

const path = require("path");
const { spawn } = require("child_process");

// Global error handlers to prevent silent crashes
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", { error: err.message, stack: err.stack });
  // Do not exit immediately to allow logs to be flushed, but PM2 will likely restart anyway
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection:", { reason });
  console.error("Unhandled Rejection:", reason);
});

// Initialize database connection
const connectWithRetry = (retries = 5, delay = 5000) => {
  dbConnection().catch((err) => {
    logger.error(`Database connection failed (Attempt ${6 - retries}/5):`, {
      error: err.message,
    });

    if (retries > 0) {
      logger.info(`Retrying database connection in ${delay / 1000} seconds...`);
      setTimeout(() => connectWithRetry(retries - 1, delay), delay);
    } else {
      logger.error(
        "All database connection attempts failed. Server will continue running but DB features will be unavailable."
      );
      // We do NOT exit here, to prevent PM2 crash loops.
      // The application should handle missing DB connections gracefully (return 500s).
    }
  });
};

if (!cluster.isMaster && !cluster.isPrimary) {
  connectWithRetry();
}

// Create express application
const app = express();

// Middleware configuration
const configureMiddleware = (app) => {
  // Before anything reads req.ip: IIS appends NGINX to X-Forwarded-For with its
  // port, which broke every per-IP limiter; req.ip becomes NGINX's X-Real-IP.
  app.use(normalizeForwardedFor);

  // Request logging middleware (should be first to capture all requests)
  app.use(requestLogger);
  app.use(securityLogger);

  // Per-endpoint counters and latency. Goes here, before everything else, so it
  // also sees the requests that a middleware rejects (rate limit, CORS, body
  // too large) — those are precisely the ones you need to count when the server
  // is under pressure, and they never reach the router.
  app.use(requestMetrics);

  // Trust proxy (required for correct IP rate limiting behind load balancers)
  app.set("trust proxy", 1);

  // Security headers
  app.use(helmet());

  // Rate limiting (RATE_LIMIT_MAX env override for local dev/e2e runs,
  // where Cypress + hot-reload easily exceed the production budget)
  const { rateLimit } = require("express-rate-limit");
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      if (!req.ip) return "unknown";
      return req.ip.replace(/:\d+[^:]*$/, "");
    },
    message: { ok: false, msg: "Too many requests from this IP, please try again later" },
  });
  app.use(limiter);

  // Timeout middleware (30 seconds)
  app.use((req, res, next) => {
    res.setTimeout(30000, () => {
      if (!res.headersSent) {
        res.status(408).json({ msg: "Request timeout", ok: false });
      }
    });
    next();
  });

  // Security and parsing middleware
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  app.use(compression());

  // Route-specific high JSON limits (100MB) for bulk operations
  const highLimitRoutes = [
    "/api/db_event/device-final-status-refactored",
    // "/api/db_event/returning-item-refactored",
    "/api/db_record/inserting-record-refactored",
    "/api/nodemailer/returned-items-summary-notification",
    "/api/nodemailer/returned-items-to-renter-notification",
  ];

  // Apply 100MB limits to specific routes
  highLimitRoutes.forEach((route) => {
    app.use(route, express.json({ limit: "100mb" }));
    app.use(route, express.urlencoded({ extended: true, limit: "100mb" }));
  });

  // Default JSON limits (50MB) for all other routes
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // // SQL Injection detection middleware
  // const { sqlInjectionDetector } = require("./middlewares/sql-injection-detector");
  // app.use(sqlInjectionDetector);

  app.use(express.static("public"));

  // Audit trail del servidor: registra cada acción de la lista de
  // constants/auditedRoutes.js con su autor. Va después del parseo del body
  // (necesita req.body) y antes de los routers; decide en `finish`.
  app.use(auditTrail);
};

// Route configuration
const configureRoutes = (app) => {
  // MongoDB Routes
  const mongoRoutes = {
    admin: require("./routes/admin"),
    article: require("./routes/article"),
    auth: require("./routes/auth"),
    registration: require("./routes/registration"),
    "cash-report": require("./routes/cashReport"),
    company: require("./routes/company"),
    devitrak: require("./routes/devitrakApp"),
    document: require("./routes/document"),
    error_log: require("./routes/errorLog"),
    event: require("./routes/event"),
    "event-log": require("./routes/eventLog"),
    feedback: require("./routes/feedback"),
    "heavy-task": require("./routes/heavyTask"),
    image: require("./routes/image"),
    inventory: require("./routes/inventory"),
    item: require("./routes/item"),
    jobs: require("./routes/jobs"),
    lease: require("./routes/lease"),
    nodeMailer: require("./routes/nodeMailer"),
    notificationLog: require("./routes/notificationLog"),
    post: require("./routes/post"),
    receiver: require("./routes/receivers"),
    search: require("./routes/search"),
    staff: require("./routes/staff"),
    "staff-activity-log": require("./routes/staffActivityLog"),
    stripe: require("./routes/stripe"),
    subscription: require("./routes/subscription"),
    transaction: require("./routes/transaction"),
    "transaction-audit-log": require("./routes/transactionAuditLog"),
  };

  // MySQL Routes
  const mysqlRoutes = {
    company: require("./mysql/routes/company"),
    consumer_attending_event_record: require("./mysql/routes/consumerAttendingEvent"),
    consumer: require("./mysql/routes/consumers"),
    event: require("./mysql/routes/events"),
    item: require("./mysql/routes/item"),
    identifier: require("./mysql/routes/identifier"),
    record: require("./mysql/routes/recordEvent"),
    staff: require("./mysql/routes/staff"),
    stripe: require("./mysql/routes/stripe"),
    lease: require("./mysql/routes/lease"),
    inventory: require("./mysql/routes/inventory"),
    member: require("./mysql/routes/members"),
    location: require("./mysql/routes/location"),
    "sub_location": require("./mysql/routes/sub_location"),
    shipment: require("./mysql/routes/shipment"),
    // utils: require("./mysql/routes/utils")
  };

  // Utility Routes
  const utilityRoutes = {
    cache: require("./routes/cache_route"),
    cloudinary: require("./cloudinary/connection"),
  };

  // Mount MongoDB routes
  Object.entries(mongoRoutes).forEach(([name, router]) => {
    app.use(`/api/${name.toLowerCase()}`, router);
  });

  // Mount MySQL routes
  Object.entries(mysqlRoutes).forEach(([name, router]) => {
    app.use(`/api/db_${name.toLowerCase()}`, router);
  });

  // Mount utility routes
  app.use("/api/cache_update", utilityRoutes.cache);
  // Token de consumidor (fase C): la foto de perfil exige el enlace del correo.
  app.use("/api/cloudinary", consumerTokenGate({ verifiedOnly: true }), utilityRoutes.cloudinary);

  // Mount consumer public namespace (attendees app; no token required)
  app.use("/api/consumer", require("./routes/consumer"));

  // Mount school (education) namespace — gated per-route by company.industry='Education'
  app.use("/api/school", require("./mysql/routes/school"));

  app.use("/api", require("./routes/status"));

  // Vista agregada del CLUSTER, no de este proceso: sale de Redis, donde los
  // cuatro vuelcan. Protegida como /api/jobs/stats — es informacion operativa,
  // e incluye un top de clientes por volumen.
  // El gate se apoya en `req.uid`, y quien lo pone es `validateJWT`. Sin el no
  // queda mas estricto: queda INALCANZABLE — responde 401 a todo, token valido
  // incluido. Es el mismo orden que /api/jobs/stats (routes/jobs.js:23).
  //
  // Y es `requirePlatformRead`, no `requireSuperUser`: este endpoint agrega
  // datos de TODAS las companias, asi que su puerta tiene que ser un flag de
  // lectura acotado y no el de bypass total de escritura.
  const { validateJWT } = require("./middlewares/validate-jwt");
  const { requirePlatformRead } = require("./middlewares/requirePlatformRead");
  app.get("/api/metrics", validateJWT, requirePlatformRead, async (req, res) => {
    try {
      const hours = Math.min(3, Math.max(1, Number(req.query.hours) || 2));
      const snapshot = await metrics.snapshot({ hours });
      return res.json({ ok: true, ...snapshot });
    } catch (error) {
      logger.error("metrics snapshot failed", { error: error.message });
      return res.status(503).json({ ok: false, msg: "metrics unavailable", error: error.message });
    }
  });
};

// Error handling middleware
const configureErrorHandling = (app) => {
  app.use((err, req, res, next) => {
    const clientInfo = {
      realIP: req.get("X-Real-IP") || req.get("X-Forwarded-For") || req.ip,
      requestId: req.get("X-Request-ID"),
      timezone: req.get("X-Timezone"),
      userAgent: req.get("User-Agent"),
    };

    logger.error("Unhandled Error", {
      type: "unhandled_error",
      clientInfo,
      error: err.message,
      method: req.method,
      stack: err.stack,
      timestamp: new Date().toISOString(),
      url: req.originalUrl,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: "Something went wrong!",
        message:
          process.env.NODE_ENV === "development"
            ? err.message
            : "Internal server error",
        requestId: clientInfo.requestId,
      });
    }
  });
};

// Initialize application
const initializeApp = () => {
  // ORDEN DELIBERADO, no una casualidad: las rutas de sondeo se montan ANTES
  // del middleware global para que no compartan el limitador de 300/15min con
  // el trafico de la API (un pico dejaria a nssm sin poder sondear, y el
  // supervisor reiniciaria un proceso sano) ni escriban una linea de log por
  // cada comprobacion. Llevan su propia cadena: metricas siempre, y limitador
  // propio en /ready. El porque completo esta en routes/health.js, y
  // test/healthRoutes.test.js lo fija como invariante.
  app.use(require("./routes/health"));

  configureMiddleware(app);
  configureRoutes(app);
  configureErrorHandling(app);
  return app;
};

// Cluster configuration
const startServer = () => {
  // El volcado de metricas arranca en TODOS los procesos, a proposito: cada uno
  // acumula las peticiones que atendio y las cuatro instancias incrementan las
  // MISMAS claves de Redis con HINCRBY, que es atomico. Ponerlo detras del
  // guard de "primera instancia" que usan los schedulers daria una vista de un
  // cuarto del trafico y nadie lo notaria.
  if (process.env.METRICS_ENABLED !== "false") {
    metrics.startFlushing();
  }
  // RAM y CPU de este proceso a logs/runtime-metrics.log, también en todos.
  require("./helpers/runtimeMetrics").startRuntimeMetrics();

  // Check if running under PM2
  const isPM2 = process.env.NODE_APP_INSTANCE !== undefined;

  // Native Master: Only if NOT running under PM2 and IS the cluster master
  const isNativeMaster = (cluster.isPrimary || cluster.isMaster) && !isPM2;

  // PM2 First Instance: If running under PM2, instance 0 acts as the "master" for singletons like Go worker
  const isPM2FirstInstance = process.env.NODE_APP_INSTANCE === "0";

  // Start Go Worker if we are the Native Master OR the first PM2 instance
  if (isNativeMaster || isPM2FirstInstance) {
    // Determine executable name based on platform
    const isWindows = process.platform === "win32";
    const execName = isWindows ? "worker.exe" : "worker";
    const workerPath = path.resolve(__dirname, "go-worker", execName);
    const fs = require("fs");

    // Log the resolved target ALWAYS (not only in the external topology), and
    // resolve it through helpers/goWorker.js so this line can never disagree
    // with what runtime actually calls. A silent Node/worker port mismatch took
    // weeks to find in prod precisely because no startup line ever stated the
    // address Node would dial.
    const { host: workerHost, port: workerPort } =
      require("./helpers/goWorker").resolveWorkerTarget();
    logger.info(`Go worker target: http://${workerHost}:${workerPort}`);

    // GO_WORKER_EXTERNAL=true: the Go worker runs as its own service/host (see
    // helpers/goWorker.js GO_WORKER_HOST) — Node must NOT spawn a local copy.
    // This switch enables the split-services topology; default (unset) preserves
    // today's behavior of spawning a co-located worker.
    if (process.env.GO_WORKER_EXTERNAL === "true") {
      logger.info(
        `GO_WORKER_EXTERNAL=true — not spawning a local Go worker; using the target above.`
      );
    } else if (fs.existsSync(workerPath)) {
      logger.info(`Starting Go worker...`);
      const goWorker = spawn(workerPath, [], {
        cwd: path.resolve(__dirname, "go-worker"),
        stdio: "inherit",
      });

      goWorker.on("error", (err) => {
        logger.error("Failed to start Go worker", { error: err.message });
      });

      goWorker.on("exit", (code, signal) => {
        logger.warn(`Go worker exited with code ${code} and signal ${signal}`);
      });

      const killWorker = () => {
        if (!goWorker.killed) {
          goWorker.kill();
        }
      };

      process.on("exit", killWorker);
      process.on("SIGINT", () => {
        killWorker();
        process.exit();
      });
      process.on("SIGTERM", () => {
        killWorker();
        process.exit();
      });
      process.once("SIGUSR2", () => {
        killWorker();
        process.kill(process.pid, "SIGUSR2");
      });
    } else {
      logger.warn(
        `Go worker executable not found at ${workerPath}. Skipping start.`
      );
    }

    // Start the durable task queue worker (single instance only).
    // See DESIGN_task_queue.md.
    try {
      require("./queue/worker").start();
    } catch (error) {
      logger.error("Failed to start task queue worker:", { error: error.message });
    }

    // Initialize scheduled jobs (overdue reminders, etc.) — single instance only.
    try {
      const { initScheduledJobs } = require("./scheduler");
      initScheduledJobs();
    } catch (error) {
      logger.error("Failed to initialize scheduled jobs:", { error: error.message });
    }
  }

  // Disable native cluster mode to prevent infinite loops and simplify debugging
  const ENABLE_NATIVE_CLUSTER = false;

  if (isNativeMaster && ENABLE_NATIVE_CLUSTER) {
    logger.info(`Starting server with ${NUM_CPU} workers on port ${PORT}`);

    // Fork workers based on CPU cores
    for (let i = 0; i < NUM_CPU; i++) {
      cluster.fork();
    }

    // Handle worker events
    cluster.on("exit", (worker, code, signal) => {
      logger.warn(
        `Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}).`
      );

      // Optional: Add a small delay before restarting to prevent rapid loops if the error is persistent
      setTimeout(() => {
        logger.info("Restarting worker...");
        cluster.fork();
      }, 1000);
    });
  } else {
    // If we are running in single-process mode (master), we need to connect to DB explicitly
    // because the top-level connection logic is skipped for master
    if (cluster.isMaster || cluster.isPrimary) {
      connectWithRetry();
    }

    const server = initializeApp().listen(PORT, BIND_HOST, () => {
      logger.info(`Worker ${process.pid} started on ${BIND_HOST}:${PORT}`);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        logger.error(
          `Port ${PORT} is already in use. Process ${process.pid} cannot start.`
        );
        // In cluster mode, this is fatal for this worker.
        process.exit(1);
      } else {
        logger.error("Server failed to start:", err);
        process.exit(1);
      }
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      logger.info("SIGTERM received. Shutting down gracefully...");
      server.close(() => {
        logger.info("Process terminated");
        process.exit(0);
      });
    });
  }
};

startServer();
