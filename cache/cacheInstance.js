const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 600 }); // TTL of 600 seconds (10 minutes)

module.exports = {
  cache
}
