const { clientRedis } = require("../database/cacheMemoryConfig");
const logger = require("../helpers/logger");

const updateCache = async (request, response) => {
  try {
    const { key } = request.body;
    const cache_connection = await clientRedis();
    cache_connection.del(`${key}`);
    response.status(201).json({
      ok: true,
      message: "Cache updated successfully",
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      message: "Error updating cache",
      error,
    });
  }
};

module.exports = updateCache;