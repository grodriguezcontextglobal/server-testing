const express = require("express");
const compression = require("compression");
const cors = require("cors");
const cluster = require("node:cluster");
const OS = require("node:os");
const { dbConnection } = require("./database/config");

// Load environment variables
require("dotenv").config();

// Configuration imports
const { corsOptions } = require("./config/cors");
const { requestLogger, securityLogger } = require("./middlewares/requestLogger");
const logger = require("./helpers/logger");

// Constants
const NUM_CPU = OS.cpus().length;
const PORT = process.env.PORT || 34001;

// Initialize database connection
dbConnection().catch(err => {
    logger.error('Database connection failed:', { error: err.message, stack: err.stack });
    process.exit(1);
});

// Create express application
const app = express();

// Middleware configuration
const configureMiddleware = (app) => {
    // Request logging middleware (should be first to capture all requests)
    app.use(requestLogger);
    app.use(securityLogger);
    
    // Security and parsing middleware
    app.use(cors(corsOptions));
    // Handle pre-flight requests
    app.options("*", cors(corsOptions));
    app.use(compression());
    
    // Route-specific high JSON limits (100MB) for bulk operations
    const highLimitRoutes = [
        '/api/db_event/device-final-status-refactored',
        '/api/db_event/returning-item-refactored',
        '/api/db_record/inserting-record-refactored',
        '/api/nodemailer/returned-items-summary-notification'
    ];
    
    // Apply 100MB limits to specific routes
    highLimitRoutes.forEach(route => {
        app.use(route, express.json({ limit: '100mb' }));
        app.use(route, express.urlencoded({ limit: '100mb', extended: true }));
    });
    
    // Default JSON limits (50MB) for all other routes
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
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
        'event-log': require("./routes/eventLog"),
        event: require("./routes/event"),
        'transaction-audit-log': require("./routes/transactionAuditLog"),
        notificationLog: require("./routes/notificationLog"),
        'cash-report': require("./routes/cashReport"),
        nodeMailer: require("./routes/nodeMailer"),
        inventory: require("./routes/inventory"),
        item: require("./routes/item"),
        image: require("./routes/image"),
        lease: require("./routes/lease"),
        search: require("./routes/search"),
        feedback: require("./routes/feedback"),
        'error_log': require("./routes/errorLog"),
        post: require("./routes/post"),
        document: require("./routes/document"),
        devitrak: require("./routes/devitrakApp"),
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
        // utils: require("./mysql/routes/utils")
    };

    // Utility Routes
    const utilityRoutes = {
        cache: require("./routes/cache_route"),
        cloudinary: require("./cloudinary/connection")
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
    app.use('/api', require('./routes/status'));
};

// Error handling middleware
const configureErrorHandling = (app) => {
    app.use((err, req, res, next) => {
        const clientInfo = {
            userAgent: req.get('User-Agent'),
            requestId: req.get('X-Request-ID'),
            realIP: req.get('X-Real-IP') || req.get('X-Forwarded-For') || req.ip,
            timezone: req.get('X-Timezone')
        };

        logger.error('Unhandled Error', {
            type: 'unhandled_error',
            error: err.message,
            stack: err.stack,
            method: req.method,
            url: req.originalUrl,
            clientInfo,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: 'Something went wrong!',
            message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
            requestId: clientInfo.requestId
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
    if (cluster.isPrimary) {
        logger.info(`Starting server with ${NUM_CPU} workers on port ${PORT}`);
        
        // Fork workers based on CPU cores
        for (let i = 0; i < NUM_CPU; i++) {
            cluster.fork();
        }

        // Handle worker events
        cluster.on("exit", (worker, code, signal) => {
            logger.warn(`Worker ${worker.process.pid} died. Restarting...`);
            cluster.fork();
        });
    } else {
        const server = initializeApp().listen(PORT, () => {
            logger.info(`Worker ${process.pid} started on port ${PORT}`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received. Shutting down gracefully...');
            server.close(() => {
                logger.info('Process terminated');
                process.exit(0);
            });
        });
    }
};

startServer();
