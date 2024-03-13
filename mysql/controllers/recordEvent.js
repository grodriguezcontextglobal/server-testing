require('dotenv').config()
const { response } = require("express");
const { createConnection } = require('mysql2');

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

const insertingRecordInEvent = (request, response) => {
    try {
        const { email, serial_number, status, activity, payment_id, event, item_group, category_name } = request.body;

        const query = `INSERT INTO record_event (item_id, consumer_id, status, activity, payment_id)
        SELECT
            ii.item_id,
            ci.consumer_id,
            ? AS status,
            ? AS activity,
            ? AS payment_id
            ? AS event
        FROM
            item_invt AS ii
        JOIN
            consumer_info AS ci ON ci.email = ?
        WHERE
            ii.item_group = ?
            AND ii.category_name = ?
            AND ii.serial_number = ?;
        `;

        // Create an array of values for the prepared statement
        const values = [email, serial_number, status, activity, payment_id, event, item_group, category_name  ];

        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response.status(201).json({
                ok: true,
                msg: 'Items inserted successfully into event',
                inserted_record: result.affectedRows
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
};

const displayRecord = (request, response) => {
    try {
        const query = `SELECT
        ii.serial_number,
        ci.email,
        re.status,
        re.activity,
        re.payment_id
    FROM
        record_event AS re
    JOIN
        consumer_info AS ci ON ci.consumer_id = re.consumer_id 
    JOIN 
        item_inv AS ii ON ii.item_id = re.item_id;
    `;

        // Create an array of values for the prepared statement
        const values = [event_id, item_group, category_name, min_serial_number, max_serial_number];

        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response.status(201).json({
                ok: true,
                msg: 'Items inserted successfully into event',
                inserted_items: result.affectedRows
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
};

const consultingInventoryCurrentState = (request, response) => {
    try {
        const { company_name } = request.body;
        const query = `SELECT
        ii.serial_number,
        ci.email,
        re.status,
        re.activity,
        re.payment_id
    FROM
        record_event AS re
    JOIN
        consumer_info AS ci ON ci.consumer_id = re.consumer_id 
    JOIN 
        item_inv AS ii ON ii.item_id = re.item_id;
    `;
        const values = [company_name];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response.status(201).json({
                ok: true,
                result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
};

const consultingInventoryInEvent = (request, response) => {
    try {
        const event_id = request.params.id;
        const query = `
                            SELECT
                            ii.item_id , ii.category_name, ii.item_group ,ii.serial_number ,ii.warehouse, ii.cost , iiae.status , iiae.condition ,iiae.updated_at 
                FROM
                    item_inv ii
                LEFT JOIN (
                    SELECT
                        item_id,
                        MAX(created_at) AS max_created_at
                    FROM
                        item_inv_assigned_event
                    GROUP BY
                        item_id
                            ) max_iiae ON
                    ii.item_id = max_iiae.item_id
                LEFT JOIN item_inv_assigned_event iiae ON
                    ii.item_id = iiae.item_id
                    AND max_iiae.max_created_at = iiae.created_at
                LEFT JOIN event_info ei ON
                    ei.event_id = iiae.event_id
                WHERE
                    ei.event_id = ?
                    ORDER BY ii.serial_number ASC`;
        const values = [event_id];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response.status(201).json({
                ok: true,
                result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
};

module.exports = {
    insertingRecordInEvent
};