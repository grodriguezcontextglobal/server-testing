require('dotenv').config()
const { response } = require("express");
const getConnection = require('../database/config');
const insertingCompany = (request, response) => {
    try {
        const connection = getConnection()
        const { company_name, street_address, city_address, state_address, zip_address, phone_number, email_company, industry } = request.body;
        const query = `insert into company_info
        (company_name, street_address, city_address, state_address, zip_address, phone_number, email_company, industry)
        values(?,?,?,?,?,?,?,?)`;

        const values = [company_name, street_address, city_address, state_address, zip_address, phone_number, email_company, industry];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });
            return response.status(201).json({
                ok: true,
                company: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
    // finally {
    //     connection.end();
    // }
};

const consultingCompany = (request, response) => {
    try {
        const connection = getConnection()
        const reference = Object.entries(request.body) //method to pass any key value to search
        const query = `select * from company_info where \`${reference[0][0]}\`=?`;
        const values = [reference[0][1]];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response.status(201).json({
                ok: true,
                company: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
    // finally {
    //     connection.end();
    // }
};

const deleteCompany = async () => {
    try {
        const connection = getConnection()
        const query = 'delete from company_info where company_id=?';
        const values = [request.body.company_id];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response?.status(201)?.json({
                ok: true,
                company_deleted: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
    }
    // finally {
    //     connection.end();
    // }
};

const consultingCompanyTable = async (request, response) => {
    try {
        const connection = getConnection()
        const query = 'select * from company_info;';
        const values = [];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response?.status(201)?.json({
                ok: true,
                companies: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
    // finally {
    //     connection.end();
    // }
};

const consultingIndustryCompanyTable = async (request, response) => {
    try {
        const connection = getConnection()
        const query = 'select industry from company_info;';
        const values = [];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response?.status(201)?.json({
                ok: true,
                industry: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
    // finally {
    //     connection.end();
    // }
};

module.exports = {
    consultingCompany,
    insertingCompany,
    consultingCompanyTable,
    deleteCompany,
    consultingIndustryCompanyTable
};