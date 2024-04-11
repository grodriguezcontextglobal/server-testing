const { response, request } = require('express')
const { createConnection } = require('mysql2');
const getConnection = require('../database/config');
require('dotenv').config()

const connection = getConnection()

const insertingStaffMember = (request, response) => {
    try {
        const { first_name, last_name, email, phone_number } = request.body
        const query = `insert into staff_member 
        (first_name, last_name, email, phone_number ) 
        values(?,?,?,?)`;
        const values = [`${first_name}`, `${last_name}`, `${email}`, `${phone_number}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                member: result
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



const consultingStaffMemberInformation = (request, response) => {
    try {
        const reference = Object.entries(request.body)
        const query = `select * from staff_member where \`${reference[0][0]}\`=?`;
        const values = [`${reference[0][1]}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                member: result
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

const consultingEventTable = async (request, response) => {
    try {
        const { event_name, zip_address } = request.body
        const query = 'select * from event_info where event_name = ? and zip_address = ?';
        const values = [event_name, zip_address];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response?.status(201)?.json({
                ok: true,
                events: result
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

const deleteEvent = async () => {
    try {
        const query = 'delete from event_info where event_id=?';
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
    insertingStaffMember,
    consultingStaffMemberInformation
}