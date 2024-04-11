const redis = require('redis')
require('dotenv').config();

const clientRedis = redis.createClient({
    host: "redis-server",
    port: 6379
});

module.exports = {
    clientRedis
};
