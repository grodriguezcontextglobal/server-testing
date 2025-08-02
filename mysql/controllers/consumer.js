require("dotenv").config();
const { createPool } = require("mysql2");
const getConnection = require("../database/config");

const insertingCustomer = async (request, response) => {
  try {
    const pool = await getConnection();
    const { first_name, last_name, email, phone_number } = request.body;
    const query = `INSERT INTO consumer_info (first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?)`;
    const values = [
      first_name,
      last_name,
      email,
      phone_number ?? "000-000-0000",
    ];

    const [result] = await pool.execute(query, values);
    return response.status(201).json({ ok: true, consumer: result });
  } catch (error) {
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingConsumerInfo = async (request, response) => {
  try {
    const pool = await getConnection();
    const formatting = Object.keys(request.body).map((item) => `${item}=?`);
    const keys = formatting.join(" AND ");
    const values = Object.values(request.body);
    const query = `SELECT * FROM consumer_info WHERE ${keys}`;

    const [result] = await pool.execute(query, values);
    return response.status(200).json({ ok: true, consumer: result });
  } catch (error) {
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingConsumerTable = async (request, response) => {
  try {
    const pool = await getConnection();
    const query = "SELECT * FROM consumer_info;";
    const [result] = await pool.execute(query);
    return response.status(200).json({ ok: true, consumers: result });
  } catch (error) {
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteCustomer = async (request, response) => {
  try {
    const pool = await getConnection();
    const query = "DELETE FROM consumer_info WHERE consumer_id=?";
    const values = [request.body.consumer_id];
    const [result] = await pool.execute(query, values);
    return response.status(200).json({ ok: true, consumer_deleted: result });
  } catch (error) {
    response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  consultingConsumerInfo,
  insertingCustomer,
  consultingConsumerTable,
  deleteCustomer,
};
