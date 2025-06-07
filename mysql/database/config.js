const mysql = require('mysql2');
require('dotenv').config();

let connection = null;

const getConnection = () => {
  if (!connection) {
    connection = mysql.createPool({
      connectionLimit: parseInt(process.env.PLANETSCALE_DATABASE_LIMIT, 10) || 100,
      host: process.env.PLANETSCALE_DATABASE_HOST,
      user: process.env.PLANETSCALE_DATABASE_USERNAME,
      password: process.env.PLANETSCALE_DATABASE_PASSWORD,
      database: process.env.PLANETSCALE_DATABASE_NAME,
      ssl: {
        rejectUnauthorized: true,
      },
    }).promise();

    connection.on('error', (err) => {
      console.error('Error in connection:', err.message);
    });
    connection.on('end', () => {
      console.log('Connection ended.');
    });
    connection.on('close', () => {
      console.log('Connection closed.');
    });
    connection.on('timeout', () => {
      console.log('Connection timeout.');
    });
    connection.on('drain', () => {
      console.log('Connection drain.');
    });
    connection.on('connect', () => {
      console.log('Connection created.');
    });
  }
  return connection;
};

// getConnection()
//   .query('SELECT 1')
//   .then(() => console.log('✅ Connection OK'))
//   .catch(err => console.error('❌ Connection failed:', err.message));

  
module.exports = getConnection;
