require("dotenv").config();
const getConnection = require("../database/config");

const insertingNewLease = async (request, response) => {
  try {
    const connection = getConnection();
    const subscription_initial_date = new Date();
    const {
      staff_admin_id,
      company_id,
      subscription_expected_return_data,
      location,
      staff_member_id,
      device_id,
    } = request.body;

    const query = `
      INSERT INTO lease_info (
        staff_admin_id,
        company_id,
        subscription_expected_return_data,
        subscription_initial_date,
        location,
        staff_member_id,
        device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      staff_admin_id,
      company_id,
      subscription_expected_return_data,
      subscription_initial_date,
      location,
      staff_member_id,
      device_id,
    ];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({ ok: true, lease: result });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const insertingNewLeaseConsumer = async (request, response) => {
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      staff_admin_id,
      company_id,
      subscription_expected_return_data,
      subscription_initial_date,
      location,
      consumer_member_id,
      device_id,
    ];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({ ok: true, lease: result });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingLease = async (request, response) => {
  try {
    const connection = getConnection();
    const keys = Object.keys(request.body).map((key) => `${key}=?`).join(" AND ");
    const values = Object.values(request.body);

    const query = `SELECT * FROM lease_info WHERE ${keys}`;
    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, lease: result });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingConsumerLease = async (request, response) => {
  try {
    const connection = getConnection();
    const keys = Object.keys(request.body).map((key) => `${key}=?`).join(" AND ");
    const values = Object.values(request.body);

    const query = `SELECT * FROM lease_customer_info WHERE ${keys}`;
    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, lease: result });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
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

    const query = `
      UPDATE lease_info 
      SET subscription_returned_date=?, subscription_current_in_use=?, active=?
      WHERE company_id=? AND staff_member_id=? AND staff_admin_id=? AND device_id=?`;

    const values = [
      subscription_returned_date,
      subscription_current_in_use,
      active,
      company_id,
      staff_member_id,
      staff_admin_id,
      device_id,
    ];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, items: result.affectedRows });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
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

    const query = `
      UPDATE lease_customer_info 
      SET subscription_returned_date=?, subscription_current_in_use=?, active=?
      WHERE company_id=? AND consumer_member_id=? AND staff_admin_id=? AND device_id=?`;

    const values = [
      subscription_returned_date,
      subscription_current_in_use,
      active,
      company_id,
      consumer_member_id,
      staff_admin_id,
      device_id,
    ];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, items: result.affectedRows });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteLeaseInfo = async (request, response) => {
  try {
    const connection = getConnection();
    const { company_id, staff_member_id, device_id } = request.body;

    const query = `
      DELETE FROM lease_info 
      WHERE company_id=? AND staff_member_id=? AND device_id=?`;

    const values = [company_id, staff_member_id, device_id];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, items: result.affectedRows });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteConsumerLeaseInfo = async (request, response) => {
  try {
    const connection = getConnection();
    const { company_id, consumer_member_id, device_id } = request.body;

    const query = `
      DELETE FROM lease_customer_info 
      WHERE company_id=? AND consumer_member_id=? AND device_id=?`;

    const values = [company_id, consumer_member_id, device_id];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, items: result.affectedRows });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  insertingNewLease,
  insertingNewLeaseConsumer,
  consultingLease,
  consultingConsumerLease,
  updateLeaseInfo,
  updateConsumerLeaseInfo,
  deleteLeaseInfo,
  deleteConsumerLeaseInfo,
};
