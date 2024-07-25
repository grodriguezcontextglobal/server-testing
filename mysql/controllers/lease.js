const { response, request } = require("express");
const getConnection = require("../database/config");
require("dotenv").config();
const insertingNewLease = (request, response) => {
  try {
    const connection = getConnection();
    const subscription_initial_date = new Date();
    subscription_initial_date.getTime()
    const {
      staff_admin_id,
      company_id,
      subscription_expected_return_data,
      location,
      staff_member_id,
      device_id,
    } = request.body;
    const query = `
                        insert into lease_info
                        (
                        staff_admin_id,
                        company_id,
                        subscription_expected_return_data,
                        subscription_initial_date,
                        location,
                        staff_member_id,
                        device_id
                            )
                        values(?,?,?,?,?,?,?)`;
    const values = [
      staff_admin_id,
      company_id,
      subscription_expected_return_data,
      subscription_initial_date,
      location,
      staff_member_id,
      device_id,
    ];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });

      return response.status(201).json({
        ok: true,
        lease: result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const insertingNewLeaseConsumer = (request, response) => {
  try {
    const connection = getConnection();
    const {
      staff_admin_id,
      company_id,
      subscription_expected_return_data,
      subscription_initial_date,
      location,
      consumer_member_id,
      device_id,
    } = request.body;
    const query = `
      INSERT INTO lease_customer_info (
        staff_admin_id,
        company_id,
        subscription_expected_return_data,
        subscription_initial_date,
        location,
        consumer_member_id,
        device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      staff_admin_id,
      company_id,
      subscription_expected_return_data,
      subscription_initial_date,
      location,
      consumer_member_id,
      device_id,
    ];
    connection.execute(query, values, function (err, result, fields) {
      if (err) {
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      }

      return response.status(201).json({
        ok: true,
        lease: result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const consultingLease = async (request, response) => {
  try {
    const connection = getConnection();
    const formatting = Object.keys(request.body).map((item) => item + "=?");
    const keys = formatting.toString().replaceAll(",", " AND ");
    const values = [...Object.values(request.body).map((item) => item)];
    const query = `select * from lease_info where ${keys}`;
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response.status(201).json({
        ok: true,
        lease: result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const consultingConsumerLease = async (request, response) => {
  try {
    const connection = getConnection();
    const formatting = Object.keys(request.body).map((item) => item + "=?");
    const keys = formatting.toString().replaceAll(",", " AND ");
    const values = [...Object.values(request.body).map((item) => item)];
    const query = `select * from lease_customer_info where ${keys}`;
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response.status(201).json({
        ok: true,
        lease: result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const updateLeaseInfo = async (request, response) => {
  try {
    const connection = getConnection();
    const {
      subscription_returned_date,
      staff_admin_id,
      company_id,
      subscription_current_in_use,
      staff_member_id,
      device_id,
      active,
    } = request.body;
    const query = `UPDATE lease_info 
                        SET subscription_returned_date=?, subscription_current_in_use=?, active=?
                        WHERE company_id=?
                        AND staff_member_id=?
                        AND staff_admin_id=?
                        AND device_id=?`;
    const values = [
      subscription_returned_date,
      subscription_current_in_use,
      active,
      company_id,
      staff_member_id,
      staff_admin_id,
      device_id,
    ]; // Corrected order and added 'active'
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(401).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response.status(201).json({
        ok: true,
        items: result.affectedRows, // Use affectedRows to get the number of affected rows
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const updateConsumerLeaseInfo = async (request, response) => {
  try {
    const connection = getConnection();
    const {
      subscription_returned_date,
      staff_admin_id,
      company_id,
      subscription_current_in_use,
      consumer_member_id,
      device_id,
      active,
    } = request.body;
    const query = `UPDATE lease_customer_info 
                        SET subscription_returned_date=?, subscription_current_in_use=?, active=?
                        WHERE company_id=?
                        AND consumer_member_id=?
                        AND staff_admin_id=?
                        AND device_id=?`;
    const values = [
      subscription_returned_date,
      subscription_current_in_use,
      active,
      company_id,
      consumer_member_id,
      staff_admin_id,
      device_id,
    ]; // Corrected order and added 'active'
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(401).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response.status(201).json({
        ok: true,
        items: result.affectedRows, // Use affectedRows to get the number of affected rows
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

module.exports = {
  insertingNewLease,
  insertingNewLeaseConsumer,
  consultingLease,
  consultingConsumerLease,
  updateLeaseInfo,
  updateConsumerLeaseInfo,
};
