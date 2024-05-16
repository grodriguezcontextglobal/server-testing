require('dotenv').config()
const { response } = require("express");
const { createConnection } = require('mysql2');
const getConnection = require('../database/config');

const connection = getConnection()

const insertingRecordInEvent = (request, response) => {
    try {
        const { email, serial_number, status, activity, payment_id, event, item_group, category_name } = request.body;
        const query = `INSERT INTO record_event (item_id, consumer_id, status, activity, event, payment_id)
        SELECT
            ii.item_id,
            ci.consumer_id,
            ? AS status,
            ? AS activity,
            ? AS payment_id,
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
        const values = [email, serial_number, status, activity, payment_id, event, item_group, category_name];

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


module.exports = {
    insertingRecordInEvent
};