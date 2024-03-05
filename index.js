const express = require("express");
const { dbConnection } = require("./database/config");
const cors = require("cors");
require("dotenv").config();
const cluster = require('node:cluster')
const OS = require('node:os');

//create express server
const app = express();

//check CPU 
const numCpu = OS.cpus().length

//Database
dbConnection();

//cors
app.use(cors({
  origin: (origin, callback) => {
    const ACCEPTED_ORIGIN = [
      'http://localhost:3000',
      'http://localhost:3791',
      'http://localhost:5522',
      'http://localhost:5000',
      'https://admin.devitrak.net',
      'https://app.devitrak.net',
      'https://consumer-testing-app.netlify.app',
      'https://admin-devitrak-clone.netlify.app'
    ]
    if (ACCEPTED_ORIGIN.includes(origin)) {
      return callback(null, true)
    }
    if (!origin) {
      return callback(null, true)
    }
    return callback(new Error("Not allowed by CORS"))
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    'Access-Control-Allow-Methods', 'POST, GET, PUT, PATCH, OPTIONS, DELETE',
    "Access-Control-Allow-Origin", "*",
    "Content-Type", "Authorization"
  ],
  maxAge: 84600,
  // optionsSuccessStatus: 200 || 204,
  // credentials: true,
  preflightContinue: true,

}))

//public directory
app.use(express.static("public"));

//Read and body parse
app.use(express.json({ limit: "1mb" }));

//routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/stripe", require("./routes/stripe"));
app.use("/api/transaction", require("./routes/transaction"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/receiver", require("./routes/receivers"));
app.use("/api/article", require("./routes/article"));
app.use("/api/staff", require("./routes/staff"));
app.use("/api/twilio", require("./routes/twilio"));
app.use("/api/event-log", require("./routes/eventLog"));
app.use("/api/event", require("./routes/event"));
app.use("/api/transaction-audit-log", require("./routes/transactionAuditLog"));
app.use("/api/notification-log", require("./routes/notificationLog"));
app.use("/api/cash-report", require("./routes/cashReport"));
app.use("/api/nodemailer", require("./routes/nodeMailer"));
app.use("/api/inventory", require("./routes/inventory"));
app.use("/api/item", require("./routes/item"));
app.use("/api/image", require("./routes/image"));
app.use("/api/db_consumer", require("./mysql/routes/consumers"))
app.use("/api/db_event", require("./mysql/routes/events"))
app.use("/api/db_item", require("./mysql/routes/item"))
app.use("/api/db_consumer_attending_event_record", require("./mysql/routes/consumerAttendingEvent"))
app.use("/api/db_company", require("./mysql/routes/company"))
app.use("/api/db_staff", require("./mysql/routes/staff"))
app.use("/api/db_stripe", require("./mysql/routes/stripe"))

//create workers
if (cluster.isPrimary) {
  for (let index = 0; index < numCpu; index++) {
    cluster.fork()
  }
  cluster.on('exit', (worker, code, signal) => {
    cluster.fork()
  })
  cluster.on('error', (worker, code, signal) => {
    cluster.fork()
  })
  cluster.on('disconnect', (worker, code, signal) => {
    cluster.fork()
  })
} else {
  app.listen(process.env.PORT, () => {
    console.log(`Server ${process.pid} on Port`, process.env.PORT);
  });
}

