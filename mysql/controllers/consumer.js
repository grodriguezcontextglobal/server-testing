require('dotenv').config()
const { response } = require("express");
const { createConnection } = require('mysql2');

const insertingCustomer = (request, response) => {
    try {
        const connection = createConnection({
            connectionLimit: 100,
            host: 'aws.connect.psdb.cloud',
            user: 'lypzlon9pede4sd8l2sx',
            password: 'pscale_pw_fFRrYmw5LhxWIT9mPLlRol7l4E9mJuLKfEws2r3kcNx',
            database: 'devitrak_db',
            ssl: {
                rejectUnauthorized: false
            }
        });
        const { first_name, last_name, email, phone_number } = request.body
        const query = 'insert into consumer_info (first_name, last_name, email, phone_number) values(?,?,?,?)';
        const values = [`${first_name}`, `${last_name}`, `${email}`, `${phone_number}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                consumer: result
            })
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        })
    } 
}

const consultingConsumerInfo = (request, response) => {
    try {
        const connection = createConnection({
            connectionLimit: 100,
            host: 'aws.connect.psdb.cloud',
            user: 'lypzlon9pede4sd8l2sx',
            password: 'pscale_pw_fFRrYmw5LhxWIT9mPLlRol7l4E9mJuLKfEws2r3kcNx',
            database: 'devitrak_db',
            ssl: {
                rejectUnauthorized: false
            }
        });
        const formatting = Object.keys(request.body).map(item => item+'=?')
        const keys = formatting.toString().replaceAll(",", " AND ")
        const values = [...Object.values(request.body).map(item => item)]
        const query = `select * from consumer_info where ${keys}`;
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                consumer: result
            })
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    } 
}

const consultingConsumerTable = async (request, response) => {
    try {
        const connection = createConnection({
            connectionLimit: 100,
            host: 'aws.connect.psdb.cloud',
            user: 'lypzlon9pede4sd8l2sx',
            password: 'pscale_pw_fFRrYmw5LhxWIT9mPLlRol7l4E9mJuLKfEws2r3kcNx',
            database: 'devitrak_db',
            ssl: {
                rejectUnauthorized: false
            }
        });
        const query = await 'select * from consumer_info;';
        await connection.execute(query, '', function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response?.status(201)?.json(result)
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    } 
}

const deleteCustomer = async () => {
    try {
        const connection = createConnection({
            connectionLimit: 100,
            host: 'aws.connect.psdb.cloud',
            user: 'lypzlon9pede4sd8l2sx',
            password: 'pscale_pw_fFRrYmw5LhxWIT9mPLlRol7l4E9mJuLKfEws2r3kcNx',
            database: 'devitrak_db',
            ssl: {
                rejectUnauthorized: false
            }
        });
        const query = 'delete from consumer_info where consumer_id=?';
        const values = [request.body.email];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response?.status(201)?.json({
                ok: true,
                consumer_deleted: result
            })
        });
    } catch (error) {
        console.error('Error:', error.message);
    } 
}

module.exports = {
    consultingConsumerInfo,
    insertingCustomer,
    consultingConsumerTable,
    deleteCustomer,
}
