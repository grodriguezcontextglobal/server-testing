const express = require("express");
require("express-async-errors"); // Handle async errors automatically
const compression = require("compression");
const cors = require("cors");
const cluster = require("node:cluster");
const OS = require("node:os");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
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

// Initialize database connection
if (!cluster.isMaster && !cluster.isPrimary) {
  dbConnection().catch((err) => {
    logger.error("Database connection failed:", {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });
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

  // Rate limiting: 100 requests per 15 minutes per IP
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // limit each IP to 300 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
      ok: false,
      msg: "Too many requests from this IP, please try again later",
    },
  });
  app.use(limiter);

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
  if (cluster.isPrimary || cluster.isMaster) {
    logger.info(`Starting server with ${NUM_CPU} workers on port ${PORT}`);

    // Start Go Worker
    const workerPath = path.resolve(__dirname, "go-worker/processor.exe");
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
    const server = initializeApp().listen(PORT, () => {
      logger.info(`Worker ${process.pid} started on port ${PORT}`);
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
