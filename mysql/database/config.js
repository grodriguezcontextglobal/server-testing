const { createConnection } = require('mysql2');
require('dotenv').config()

const mysql = require('mysql2');

    const conn = await createConnection({
        connectionLimit: 100,
        host: process.env.PLANETSCALE_DATABASE_HOST,
        user: process.env.PLANETSCALE_DATABASE_USERNAME,
        password:process.env.PLANETSCALE_DATABASE_PASSWORD,
        database: process.env.PLANETSCALE_DATABASE_NAME,
        ssl: {
            rejectUnauthorized: false
        }
    });

module.exports = conn