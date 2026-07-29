'use strict';

/**
 * Splits an array into consecutive chunks of at most `size` items. Used to
 * keep bulk SQL statements (VALUES ?, WHERE ... IN (?)) and Mongo bulk ops
 * under the driver/server's parameter and packet-size limits instead of
 * sending one unbounded statement for the whole payload.
 */
function chunkArray(items, size) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('chunkArray: size must be a positive integer');
  }
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

module.exports = { chunkArray };
