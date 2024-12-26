require('dotenv').config()
const { response } = require("express");
const { createConnection } = require('mysql2');
const getConnection = require('../database/config');

const connection = getConnection()

const insertingConsumerAttendingEvent = async(request, response) => {
    try {
        const { consumer_attending_id, event_attended_id } = request.body;
        const query = 'insert into consumer_attending_event (consumer_attending_id,event_attended_id) values(?,?)';
        const values = [consumer_attending_id, event_attended_id];
        const [result] = await connection.promise().execute(query, values)
        // , function (err, result, fields) {
        //     if (err) return response.status(500).json({
        //         ok: false,
        //         msg: `${err.message}`,
        //     });

        // });
        return response.status(201).json({
            ok: true,
            customer: result
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    } finally {
        connection.end();
    }
};

const consultingCustomerAttendingEventsInfo = (request, response) => {
    try {
        const query = `
        SELECT s.first_name as Consumers_First_Name, s.last_name as Consumers_Last_Name, s.email  as Consumers_Email, c.event_name as Event
        FROM consumer_info s
        INNER JOIN consumer_attending_event b ON s.consumer_id  = b.consumer_attending_id
        INNER JOIN event_info c ON b.event_attended_id  = c.event_id
        ORDER BY s.first_name ;`

        connection.execute(query, "", function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response.status(201).json({
                ok: true,
                customers: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    } finally {
        connection.end();
    }
};

const renderAllCustomerByEvent = async (request, response) => {
    try {
        const query = `
        SELECT s.first_name as Consumers_First_Name, s.last_name as Consumers_Last_Name, s.email  as Consumers_Email, c.event_name as Event 
        FROM consumer_info s
        INNER JOIN consumer_attending_event b ON s.consumer_id  =  b.consumer_attending_id
        INNER JOIN event_info c ON b.event_attended_id=?  AND c.event_id=? ;`
        const values = [request.body.event, request.body.event];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response.status(201).json({
                ok: true,
                customer: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    } finally {
        connection.end();
    }
}

const consultingCustomerInfo = (request, response) => {
    try {
        const reference = Object.entries(request.body)
        const query = `select * from company_attending_event where \`${reference[0][0]}\`=?`;
        const values = [`${reference[0][1]}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response.status(201).json({
                ok: true,
                customer: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    } finally {
        connection.end();
    }
};

const consultingCustomerTable = async (request, response) => {
    try {
        const query = 'select * from consumer_attending_event;';
        await connection.execute(query, '', function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response?.status(201)?.json(result);
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    } finally {
        connection.end();
    }
};

const deleteCustomer = async () => {
    try {
        const query = 'delete from consumer_info where consumer_id=?';
        const values = [request.body.email];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response?.status(201)?.json({
                ok: true,
                customer_deleted: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        connection.end();
    }
};

module.exports = {
    consultingCustomerInfo,
    insertingConsumerAttendingEvent,
    consultingCustomerTable,
    deleteCustomer,
    consultingCustomerAttendingEventsInfo,
    renderAllCustomerByEvent
}
