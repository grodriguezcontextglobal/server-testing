const Redis = require("ioredis");
const redisUri = "rediss://default:AVNS_eVMqnew0HfkKKDU7TTw@redis-2f42aa91-devitrak-server-app.b.aivencloud.com:14158"
const redis = new Redis(redisUri);

module.exports = redis