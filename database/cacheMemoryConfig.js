const { createClient } = require("redis");

const clientRedis = async () => {
  const connecting = createClient({
    password: "4EOcn5AV1zVQA2ab675qWQKTLG5AMeHx",
    socket: {
      host: "redis-19013.c61.us-east-1-3.ec2.redns.redis-cloud.com",
      port: 19013,
    },
  });
  await connecting.connect();

  return connecting;
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
