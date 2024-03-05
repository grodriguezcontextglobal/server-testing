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

const insertingEvent = (request, response) => {
    try {
        const { event_name, venue_name, street_address, city_address, state_address, zip_address, email_company, phone_number, company_assigned_event_id } = request.body
        const query = `insert into event_info
        (event_name, venue_name, street_address, city_address, state_address, zip_address, email_company,  phone_number, company_assigned_event_id ) 
        values(?,?,?,?,?,?,?,?,?)`;
        const values = [`${event_name}`, `${venue_name}`, `${street_address}`, `${city_address}`, `${state_address}`, `${zip_address}`, `${email_company}`, `${phone_number}`, `${company_assigned_event_id}`];
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



const consultingEventInformation = (request, response) => {
    try {
        const reference = Object.entries(request.body)
        const query = `select * from event_info where \`${reference[0][0]}\`=?`;
        const values = [`${reference[0][1]}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                event: result
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

const consultingEventsPerCompany = async (request, response) => {
    try {
        const query = `select ei.*, ci.company_name from event_info ei 
        join company_info ci on ci.company_id = ei.company_assigned_event_id 
        where ci.company_id = ?;`
        const values = [request.body]
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
        console.log("🚀 ~ consultingEventsPerCompany ~ error:", error)
        response.status(500).json({
            ok: false,
            msg: error.message
        })
    }
}
const deleteEvent = async (request, response) => {
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

const insertingStaffInEvent = async (request, response) => {

    try {
        console.log('request.body', request.body)
        const query = `
        insert into staff_event (event_id, staff_id, role)
        values(?,?,?)
        `;
        const values = [request.body.event_id, request.body.staff_id, `${request.body.role}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response?.status(201)?.json({
                ok: true,
                result: result
            })
        });
    } catch (error) {
        console.error('Error:', error.message);
    }
}
module.exports = {
    consultingEventInformation,
    insertingEvent,
    consultingEventTable,
    deleteEvent,
    insertingStaffInEvent,
    consultingEventsPerCompany
}
