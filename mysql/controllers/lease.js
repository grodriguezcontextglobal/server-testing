const { response, request } = require('express')
const getConnection = require('../database/config');
require('dotenv').config()
const insertingNewLease = (request, response) => {
    try {
        const connection = getConnection()
        const { staff_admin_id, company_id, subscription_expected_return_data, location, staff_member_id, device_id } = request.body
        console.log("🚀 ~ insertingNewLease ~ request.body:", request.body)
        const query = `
                        insert into lease_info
                        (
                        staff_admin_id,
                        company_id,
                        subscription_expected_return_data,
                        location,
                        staff_member_id,
                        device_id
                            )
                        values(?,?,?,?,?,?)`;
        const values = [staff_admin_id, company_id, subscription_expected_return_data, location, staff_member_id, device_id];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                lease: result
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


const consultingLease = async (request, response) => {
    try {
        const connection = getConnection()
        const formatting = Object.keys(request.body).map(item => item+'=?')
        const keys = formatting.toString().replaceAll(",", " AND ")
        const values = [...Object.values(request.body).map(item => item)]
        const query = `select * from lease_info where ${keys}`;
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })
            return response.status(201).json({
                ok: true,
                lease: result
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

const updateLeaseInfo = async (request, response) => {
    try {
        const connection = getConnection()
        const { subscription_returned_date, staff_admin_id, company_id, subscription_current_in_use, staff_member_id, device_id, active } = request.body;
        const query = `UPDATE lease_info 
                        SET subscription_returned_date
                        WHERE staff_admin_id=?
                        AND company_id=?
                        AND subscription_current_in_use=?
                        AND staff_member_id=?
                        AND device_id=?
                        AND active=?;`;
        const values = [`${subscription_returned_date}`, staff_admin_id, company_id, subscription_current_in_use, staff_member_id, device_id, active];  // Updated values array
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(401).json({
                ok: false,
                msg: `${err.message}`,
            });
            return response.status(201).json({
                ok: true,
                items: result
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
    insertingNewLease,
    consultingLease,
    updateLeaseInfo,
}