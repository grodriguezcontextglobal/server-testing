const { createConnection } = require('mysql2');
require('dotenv').config()

const getConnection = () => {
    return createConnection({
        connectionLimit: 100,
        host: 'aws.connect.psdb.cloud',
        user: 'lypzlon9pede4sd8l2sx',
        password: 'pscale_pw_fFRrYmw5LhxWIT9mPLlRol7l4E9mJuLKfEws2r3kcNx',
        database: 'devitrak_db',
        ssl: {
            rejectUnauthorized: false
        }
    });
};

module.exports = getConnection