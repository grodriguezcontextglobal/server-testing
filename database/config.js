const mongoose = require("mongoose");
const logger = require("../helpers/logger");
require("dotenv").config();

let isConnected = false;
// dbConnection
const dbConnection = async () => {
  try {
    // Prefer IPv4 to avoid odd resolver behavior on some Windows setups
    const dns = require("dns");
    if (typeof dns.setDefaultResultOrder === "function") {
      dns.setDefaultResultOrder("ipv4first");
    }

    if (isConnected) {
      logger.log("Database is already connected.");
      return mongoose.connection;
    }

    const url = process.env.DB_CNN;
    const fallbackDirectUrl = process.env.DB_CNN_DIRECT; // optional direct URI fallback

    if (!url || typeof url !== "string" || url.trim().length === 0) {
      throw new Error("Missing DB_CNN environment variable");
    }

    const extractHostFromUri = (uri) => {
      try {
        const afterAt = uri.split("@").pop() || uri.replace(/^mongodb\+srv:\/\//, "");
        return (afterAt || "").split("/")[0];
      } catch {
        return null;
      }
    };

    // Pre-flight DNS checks for Atlas SRV URIs
    if (url.startsWith("mongodb+srv://")) {
      const host = extractHostFromUri(url);

      if (!host) {
        throw new Error("Invalid MongoDB SRV URI: unable to parse host");
      }

      // SRV check must succeed for Atlas SRV URIs
      try {
        await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
      } catch (e) {
        logger.error(
          `DNS SRV lookup failed for ${host} (${e.code || e.message}). Ensure your DNS can resolve Atlas SRV records.`
        );
        // Try direct fallback if provided
        if (fallbackDirectUrl) {
          logger.warn("Attempting direct connection fallback (DB_CNN_DIRECT)...");
          await mongoose.connect(fallbackDirectUrl, {
            serverSelectionTimeoutMS: 15000,
            appName: "devitrak-server",
          });
        } else {
          throw new Error(
            `DNS SRV lookup failed for host ${host} (${e.code || e.message}). Set DB_CNN_DIRECT to a non-SRV URI as fallback or fix DNS.`
          );
        }
      }

      // TXT lookup is optional; warn but continue if it fails (ESERVFAIL, ENODATA, etc.)
      try {
        await dns.promises.resolveTxt(host);
      } catch (e) {
        logger.warn(
          `DNS TXT lookup issue for ${host} (${e.code || e.message}). Continuing without TXT options.`
        );
      }
    }

    // Attempt connection
    await mongoose.connect(url, {
      serverSelectionTimeoutMS: 15000,
      appName: "devitrak-server",
      // retryWrites/w Majority are usually encoded in Atlas URIs, keep defaults
    });

    mongoose.connection.on("connected", () => {
      isConnected = true;
      logger.log("Connected to DB");
    });

    mongoose.connection.on("error", (err) => {
      logger.error(`Error in DB connection: ${err.message}`);
    });

    mongoose.connection.on("disconnected", () => {
      isConnected = false;
      logger.warn("Disconnected from DB");
    });

    return mongoose.connection;
  } catch (error) {
    // Provide actionable hints for common Atlas SRV failures
    const msg = error?.message || String(error);
    if (/queryTxt/i.test(msg) || /ESERVFAIL/i.test(msg)) {
      logger.error(
        `DNS TXT resolution failed. Verify your Atlas host in DB_CNN and local DNS. If needed, set DB_CNN_DIRECT to a direct (non-SRV) URI.`
      );
    }
    logger.error(`Error connecting to DB: ${msg}`);
    throw new Error(`Failed to connect to the database: ${msg}`);
  }
};

module.exports = { dbConnection };
