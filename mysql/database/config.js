const mysql = require('mysql2');
require('dotenv').config();

let connection = null;

const getConnection = () => {
  if (!connection) {
    let poolConfig;

    if (process.env.SQL_DATABASE_URL) {
      const url = new URL(process.env.SQL_DATABASE_URL);
      poolConfig = {
        host: url.hostname,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ''),
      };
    } else {
      poolConfig = {
        host: process.env.PLANETSCALE_DATABASE_HOST,
        user: process.env.PLANETSCALE_DATABASE_USERNAME,
        password: process.env.PLANETSCALE_DATABASE_PASSWORD,
        database: process.env.PLANETSCALE_DATABASE_NAME,
      };
    }

    connection = mysql.createPool({
      ...poolConfig,
      connectionLimit: parseInt(process.env.PLANETSCALE_DATABASE_LIMIT, 10) || 10,
      connectTimeout: 10000,
      ssl: { rejectUnauthorized: true },
    }).promise();
  }
  return connection;
};

// getConnection()
//   .query('SELECT 1')
//   .then(() => console.log('✅ Connection OK'))
//   .catch(err => console.error('❌ Connection failed:', err.message));

module.exports = getConnection;
