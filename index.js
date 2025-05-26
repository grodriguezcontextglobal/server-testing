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

// Constants
const NUM_CPU = OS.cpus().length;
const PORT = process.env.PORT || 34001;

// Initialize database connection
dbConnection().catch(err => {
    console.error('Database connection failed:', err);
    process.exit(1);
});

// Create express application
const app = express();

// Middleware configuration
const configureMiddleware = (app) => {
    // Security and parsing middleware
    app.use(cors(corsOptions));
    app.use(compression());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
    app.use(express.static("public"));

    // Handle pre-flight requests
    app.options("*", cors(corsOptions));
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
        receivers: require("./routes/receivers"),
        article: require("./routes/article"),
        staff: require("./routes/staff"),
        eventLog: require("./routes/eventLog"),
        event: require("./routes/event"),
        transactionAuditLog: require("./routes/transactionAuditLog"),
        notificationLog: require("./routes/notificationLog"),
        cashReport: require("./routes/cashReport"),
        nodeMailer: require("./routes/nodeMailer"),
        inventory: require("./routes/inventory"),
        item: require("./routes/item"),
        image: require("./routes/image"),
        lease: require("./routes/lease"),
        search: require("./routes/search"),
        feedback: require("./routes/feedback"),
        errorFeedback: require("./routes/errorLog"),
        post: require("./routes/post"),
        document: require("./routes/document")
    };

    // MySQL Routes
    const mysqlRoutes = {
        company: require("./mysql/routes/company"),
        consumerAttendingEvent: require("./mysql/routes/consumerAttendingEvent"),
        consumers: require("./mysql/routes/consumers"),
        events: require("./mysql/routes/events"),
        item: require("./mysql/routes/item"),
        recordEvent: require("./mysql/routes/recordEvent"),
        staff: require("./mysql/routes/staff"),
        stripe: require("./mysql/routes/stripe"),
        lease: require("./mysql/routes/lease")
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
        console.error(err.stack);
        res.status(500).json({
            error: 'Something went wrong!',
            message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
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
        console.log(`Master process ${process.pid} is running`);

        // Fork workers based on CPU cores
        for (let i = 0; i < NUM_CPU; i++) {
            cluster.fork();
        }

        // Handle worker events
        cluster.on("exit", (worker, code, signal) => {
            console.log(`Worker ${worker.process.pid} died. Restarting...`);
            cluster.fork();
        });
    } else {
        const server = initializeApp().listen(PORT, () => {
            console.log(`Worker ${process.pid} started on port ${PORT}`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            console.log('SIGTERM signal received: closing HTTP server');
            server.close(() => {
                console.log('HTTP server closed');
                process.exit(0);
            });
        });
    }
};

startServer();
