const { response, request } = require('express')
const { createConnection } = require('mysql2');
require('dotenv').config()

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

const insertingStripeCustomer= (request, response) => {
    try {
        const { stripe_id, company_id } = request.body
        const query = `insert into stripe_info
        (stripe_id, company_id )
        values(?,?)`;
        const values = [`${stripe_id}`, `${company_id}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                stripe: result
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



const consultingStripeCustomer = (request, response) => {
    try {
        const reference = Object.entries(request.body)
        const query = `select * from stripe_info where \`${reference[0][0]}\`=?`;
        const values = [`${reference[0][1]}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                stripe: result
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


module.exports = {
insertingStripeCustomer,
consultingStripeCustomer
}