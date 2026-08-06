// redisClient.js
require("dotenv").config();
const { createClient } = require("redis");

// Create a Redis client instance
let client;

const createClientRedis = ({ createClientFn = createClient } = {}) => async () => {
  if (!client) {
    if (!process.env.REDIS_PASSWORD || !process.env.REDIS_HOST) {
      throw new Error(
        "Missing REDIS_HOST/REDIS_PASSWORD environment variables"
      );
    }
    const newClient = createClientFn({
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      },
      disableOfflineQueue: false,
    });

    // Log if connected successfully
    newClient.on("connect", () => {
      console.log("Connected to Redis");
    });

    // Handle errors
    newClient.on("error", (err) => {
      console.error("Redis error:", err);
    });

    // Only promote to the module-level singleton once connect() actually
    // succeeds. If it throws, `client` stays null so the NEXT call starts a
    // fresh connection attempt instead of retrying on this same broken
    // instance (which node-redis v4 can hang on indefinitely).
    await newClient.connect();
    client = newClient;
  } else if (!client.isOpen) {
    await client.connect();
  }

  return client;
};

const clientRedis = createClientRedis();

module.exports = {
  clientRedis,
  createClientRedis,
  __resetClientForTests: () => {
    client = undefined;
  },
};
