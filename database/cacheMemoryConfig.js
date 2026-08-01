// redisClient.js
require("dotenv").config();
const { createClient } = require("redis");

// Create a Redis client instance
let client;

const clientRedis = async () => {
  if (!client) {
    if (!process.env.REDIS_PASSWORD || !process.env.REDIS_HOST) {
      throw new Error(
        "Missing REDIS_HOST/REDIS_PASSWORD environment variables"
      );
    }
    client = createClient({
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      },
      disableOfflineQueue: false,
    });
    await client.connect();

    // Log if connected successfully
    client.on("connect", () => {
      console.log("Connected to Redis");
    });

    // Handle errors
    client.on("error", (err) => {
      console.error("Redis error:", err);
    });
  } else if (!client.isOpen) {
    await client.connect();
  }

  return client;
};

module.exports = {
  clientRedis,
};
