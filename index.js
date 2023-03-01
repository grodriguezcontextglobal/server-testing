const express = require("express");
const { dbConnection } = require("./database/config");
const cors = require("cors");
require("dotenv").config(); //connect with dotenv file

//create express server
const app = express();

//Database
dbConnection();

//cors
app.use(cors({
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE"],
  origin: ["https://app.devitrak.net", "https://admin.devitrak.net"],
  credentials: true
}));
//public directory
app.use(express.static("public"));

//Read and body parse
app.use(express.json());

//routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/stripe", require("./routes/stripe"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/receiver", require("./routes/receivers"));
app.use("/api/article", require("./routes/article"));
app.use("/api/staff", require("./routes/staff"));
app.use("/api/twilio", require("./routes/twilio"));
app.use("/api/eventLog", require("./routes/eventLog"));
app.use("/api/transactionAuditLog", require("./routes/transactionAuditLog"));


//listen requests
app.listen(process.env.PORT, () => {
  console.log("Server on Port", process.env.PORT);
});
