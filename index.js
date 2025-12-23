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
const {
  requestLogger,
  securityLogger,
} = require("./middlewares/requestLogger");
const logger = require("./helpers/logger");

// Constants
const NUM_CPU = Math.min(OS.cpus().length, 4); // Limit to 4 workers to avoid resource exhaustion
const PORT = process.env.PORT || 34001;

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
  // Request logging middleware (should be first to capture all requests)
  app.use(requestLogger);
  app.use(securityLogger);

  // Trust proxy (required for correct IP rate limiting behind load balancers)
  app.set("trust proxy", 1);

  // Security headers
  app.use(helmet());

  // Rate limiting: TEMPORARILY DISABLED
  // const limiter = rateLimit({
  //   windowMs: 15 * 60 * 1000, // 15 minutes
  //   max: 300, // limit each IP to 300 requests per windowMs
  //   standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  //   legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  //   // Custom key generator to handle IPs with ports (common in some environments)
  //   keyGenerator: (req, res) => {
  //     logger.info(`Request IP: ${req.ip}`);
  //     // Handle undefined req.ip
  //     if (!req.ip) return "unknown";
  //     return req.ip.replace(/:\d+[^:]*$/, "");
  //   },
  //   message: {
  //     ok: false,
  //     msg: "Too many requests from this IP, please try again later",
  //   },
  // });
  // app.use(limiter);

  // Timeout middleware (30 seconds)
  app.use((req, res, next) => {
    res.setTimeout(30000, () => {
      res.status(408).json({ ok: false, msg: "Request timeout" });
    });
    next();
  });

  // Security and parsing middleware
  app.use(cors(corsOptions));
  // Handle pre-flight requests
  app.options("*", cors(corsOptions));
  app.use(compression());

  // Route-specific high JSON limits (100MB) for bulk operations
  const highLimitRoutes = [
    "/api/db_event/device-final-status-refactored",
    "/api/db_event/returning-item-refactored",
    "/api/db_record/inserting-record-refactored",
    "/api/nodemailer/returned-items-summary-notification",
  ];

  // Apply 100MB limits to specific routes
  highLimitRoutes.forEach((route) => {
    app.use(route, express.json({ limit: "100mb" }));
    app.use(route, express.urlencoded({ limit: "100mb", extended: true }));
  });

  // Default JSON limits (50MB) for all other routes
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(express.static("public"));
};

// Route configuration
const configureRoutes = (app) => {
  // MongoDB Routes
  const mongoRoutes = {
    auth: require("./routes/auth"),
    stripe: require("./routes/stripe"),
    subscription: require("./routes/subscription"),
    transaction: require("./routes/transaction"),
    admin: require("./routes/admin"),
    company: require("./routes/company"),
    receiver: require("./routes/receivers"),
    article: require("./routes/article"),
    staff: require("./routes/staff"),
    "staff-activity-log": require("./routes/staffActivityLog"),
    "event-log": require("./routes/eventLog"),
    event: require("./routes/event"),
    "transaction-audit-log": require("./routes/transactionAuditLog"),
    notificationLog: require("./routes/notificationLog"),
    "cash-report": require("./routes/cashReport"),
    nodeMailer: require("./routes/nodeMailer"),
    inventory: require("./routes/inventory"),
    item: require("./routes/item"),
    image: require("./routes/image"),
    lease: require("./routes/lease"),
    search: require("./routes/search"),
    feedback: require("./routes/feedback"),
    error_log: require("./routes/errorLog"),
    post: require("./routes/post"),
    document: require("./routes/document"),
    devitrak: require("./routes/devitrakApp"),
    "heavy-task": require("./routes/heavyTask"),
  };

  // MySQL Routes
  const mysqlRoutes = {
    company: require("./mysql/routes/company"),
    consumer_attending_event_record: require("./mysql/routes/consumerAttendingEvent"),
    consumer: require("./mysql/routes/consumers"),
    event: require("./mysql/routes/events"),
    item: require("./mysql/routes/item"),
    record: require("./mysql/routes/recordEvent"),
    staff: require("./mysql/routes/staff"),
    stripe: require("./mysql/routes/stripe"),
    lease: require("./mysql/routes/lease"),
    inventory: require("./mysql/routes/inventory"),
    member: require("./mysql/routes/members"),
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
  app.use("/api/cloudinary", utilityRoutes.cloudinary);
  app.use("/api", require("./routes/status"));
};

// Error handling middleware
const configureErrorHandling = (app) => {
  app.use((err, req, res, next) => {
    const clientInfo = {
      userAgent: req.get("User-Agent"),
      requestId: req.get("X-Request-ID"),
      realIP: req.get("X-Real-IP") || req.get("X-Forwarded-For") || req.ip,
      timezone: req.get("X-Timezone"),
    };

    logger.error("Unhandled Error", {
      type: "unhandled_error",
      error: err.message,
      stack: err.stack,
      method: req.method,
      url: req.originalUrl,
      clientInfo,
      timestamp: new Date().toISOString(),
    });

    res.status(500).json({
      error: "Something went wrong!",
      message:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal server error",
      requestId: clientInfo.requestId,
    });
  });
};

// Initialize application
const initializeApp = () => {
  configureMiddleware(app);
  configureRoutes(app);
  configureErrorHandling(app);
  return app;
};

// Cluster configuration
const startServer = () => {
  // Check if running under PM2
  const isPM2 = process.env.NODE_APP_INSTANCE !== undefined;

  // Native Master: Only if NOT running under PM2 and IS the cluster master
  const isNativeMaster = (cluster.isPrimary || cluster.isMaster) && !isPM2;

  // PM2 First Instance: If running under PM2, instance 0 acts as the "master" for singletons like Go worker
  const isPM2FirstInstance = process.env.NODE_APP_INSTANCE === "0";

  // Start Go Worker if we are the Native Master OR the first PM2 instance
  if (isNativeMaster || isPM2FirstInstance) {
    logger.info(`Starting Go worker...`);

    // Determine executable name based on platform
    const isWindows = process.platform === "win32";
    const execName = isWindows ? "processor.exe" : "processor";
    const workerPath = path.resolve(__dirname, "go-worker", execName);

    // Check if file exists
    const fs = require("fs");
    if (fs.existsSync(workerPath)) {
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

      process.on("exit", () => {
        goWorker.kill();
      });
    } else {
      logger.warn(
        `Go worker executable not found at ${workerPath}. Skipping start.`
      );
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

    const server = initializeApp().listen(PORT, () => {
      logger.info(`Worker ${process.pid} started on port ${PORT}`);
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
