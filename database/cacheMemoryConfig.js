// redisClient.js
const { createClient } = require("redis");

// Create a Redis client instance
let client;

const clientRedis = async () => {
  if (!client) {
    client = createClient({
      password: "4EOcn5AV1zVQA2ab675qWQKTLG5AMeHx",
      socket: {
        host: "redis-19013.c61.us-east-1-3.ec2.redns.redis-cloud.com",
        port: 19013,
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
  }
  return client;
};

module.exports = {
  clientRedis,
};

// const redisMemory = require('redis')
// const { createClient } =redisMemory

// const clientRedis = async () => {

//   try {
//     const connecting = createClient({
//       password: "WEsiydybNHxFJRKMr2EyLpHSsCbEudWp",
//       socket: {
//         host: "redis-10858.c10.us-east-1-2.ec2.redns.redis-cloud.com",
//         port: 10858,
//       },
//     })
//     return await connecting.connect()
//   } catch (error) {
//     console.log(error);
//     throw new Error(`Error in starting connecting with Redis cache memory ${error.message}`);

//   }
// };
