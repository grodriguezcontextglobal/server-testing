const { clientRedis } = require("../database/cacheMemoryConfig");

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
    console.log(error);
    response.status(500).json({
      ok: false,
      message: "Error updating cache",
      error,
    });
  }
};

module.exports = updateCache;

// app.post('/update-cache', async (req, res) => {
//   const { key, value } = req.body;
//   try {
//     await setAsync(key, JSON.stringify(value), 'EX', 3600); // Set with TTL
//     res.status(200).json({ message: 'Cache updated successfully' });
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating cache', error });
//   }
// });

// app.listen(3000, () => {
//   console.log('Middleware server running on port 3000');
// });
