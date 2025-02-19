const express = require("express");
const compression = require("compression");
const { dbConnection } = require("./database/config");
const cors = require("cors");
require("dotenv").config();
// const cookieParser = require("cookie-parser");
// const statusMonitor = require("express-status-monitor");
const cluster = require("node:cluster");
const OS = require("node:os");
const admin = require("./routes/admin");
const article = require("./routes/article");
const auth = require("./routes/auth");
const cashReport = require("./routes/cashReport");
const company = require("./routes/company");
const companySQL = require("./mysql/routes/company");
const consumerAttendingEvent = require("./mysql/routes/consumerAttendingEvent");
const consumers = require("./mysql/routes/consumers");
const event = require("./routes/event");
const eventLog = require("./routes/eventLog");
const eventSQL = require("./mysql/routes/events");
const image = require("./routes/image");
const inventory = require("./routes/inventory");
const item = require("./routes/item");
const itemSQl = require("./mysql/routes/item");
const nodeMailer = require("./routes/nodeMailer");
const notificationLog = require("./routes/notificationLog");
const receivers = require("./routes/receivers");
const recordEvent = require("./mysql/routes/recordEvent");
const staff = require("./routes/staff");
const staffSQL = require("./mysql/routes/staff");
const stripe = require("./routes/stripe");
const stripeSQL = require("./mysql/routes/stripe");
const subscription = require("./routes/subscription");
const transaction = require("./routes/transaction");
const transactionAuditLog = require("./routes/transactionAuditLog");
const lease = require("./routes/lease");
const leaseSQL = require("./mysql/routes/lease");
const cache_route = require("./routes/cache_route");
const cloudinaryImageUpload = require("./cloudinary/connection");
const search = require("./routes/search");
// const responseTime = require("response-time");
// const { cookie } = require("express-validator");
const feedback = require("./routes/feedback");
//check CPU
const numCpu = OS.cpus().length;

//Database
dbConnection();

// CORS configuration
const ACCEPTED_ORIGINS = [
  "http://localhost:5522",
  "https://devitrak-app-survey.pages.dev",
  "http://localhost:3791",
  "https://admin.devitrak.net",
  "https://app.devitrak.net",
  "https://admin-testing-dev.netlify.app",
  "https://login.microsoftonline.com/",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || ACCEPTED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-token",
    "token",
    "Cookie",
    "Set-Cookie",
    "credentials",
  ],
  cookie: true,
  credentials: true,
  // preflightContinue: false,
  maxAge: 84600,
  optionsSuccessStatus: 200,
};

//create express server
const app = express();

// //response time
// app.use(responseTime());

// Enable Gzip compression
app.use(compression());

app.use(cors(corsOptions));

// Handle pre-flight requests
app.options("*", cors(corsOptions));

//public directory
app.use(express.static("public"));

//cookie parser
// app.use(cookieParser());

//Read and body parse
app.use(express.json({ limit: "1mb" }));

//routes
app.use("/api/auth", auth);
app.use("/api/stripe", stripe);
app.use("/api/subscription", subscription);
app.use("/api/transaction", transaction);
app.use("/api/admin", admin);
app.use("/api/company", company);
app.use("/api/receiver", receivers);
app.use("/api/article", article);
app.use("/api/staff", staff);
app.use("/api/event-log", eventLog);
app.use("/api/event", event);
app.use("/api/transaction-audit-log", transactionAuditLog);
app.use("/api/notification-log", notificationLog);
app.use("/api/cash-report", cashReport);
app.use("/api/nodemailer", nodeMailer);
app.use("/api/inventory", inventory);
app.use("/api/item", item);
app.use("/api/image", image);
app.use("/api/lease", lease);
app.use("/api/db_consumer", consumers);
app.use("/api/db_event", eventSQL);
app.use("/api/db_item", itemSQl);
app.use("/api/db_consumer_attending_event_record", consumerAttendingEvent);
app.use("/api/db_company", companySQL);
app.use("/api/db_staff", staffSQL);
app.use("/api/db_stripe", stripeSQL);
app.use("/api/db_record", recordEvent);
app.use("/api/db_lease", leaseSQL);
app.use("/api/cloudinary", cloudinaryImageUpload);
app.use("/api/cache_update", cache_route);
app.use("/api/search", search);
app.use("/api/feedback", feedback);
// app.listen(process.env.PORT);
if (cluster.isPrimary) {
  for (let index = 0; index < numCpu; index++) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code, signal) => {
    cluster.fork();
  });
  cluster.on("error", (worker, code, signal) => {
    cluster.fork();
  });
  cluster.on("disconnect", (worker, code, signal) => {
    cluster.fork();
  });
} else {
  app.listen(process.env.PORT);
}
