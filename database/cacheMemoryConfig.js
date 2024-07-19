const { RedisStore } = require('rate-limit-redis')

const memoryCacheConnection = async () => {
    try {
        const client = createClient({
            // ... (see https://github.com/redis/node-redis/blob/master/docs/client-configuration.md)
        })
        // Then connect to the Redis server
        await client.connect()    } catch (error) {
      console.log(error);
      throw new Error(`Error in starting connecting with DB ${error.message}`);
    }
  };
  
  module.exports = {
    dbConnection
  };
  