require("dotenv").config();
const { createPool } = require("mysql2");

// Create a reusable connection pool
const pool = createPool({
  connectionLimit: 100,
  host: "aws.connect.psdb.cloud",
  user: "lypzlon9pede4sd8l2sx",
  password: "pscale_pw_fFRrYmw5LhxWIT9mPLlRol7l4E9mJuLKfEws2r3kcNx",
  database: "devitrak_db",
  ssl: { rejectUnauthorized: false },
}).promise();

const insertingCustomer = async (request, response) => {
  try {
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
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingConsumerInfo = async (request, response) => {
  try {
    const formatting = Object.keys(request.body).map((item) => `${item}=?`);
    const keys = formatting.join(" AND ");
    const values = Object.values(request.body);
    const query = `SELECT * FROM consumer_info WHERE ${keys}`;

    const [result] = await pool.execute(query, values);
    return response.status(200).json({ ok: true, consumer: result });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingConsumerTable = async (request, response) => {
  try {
    const query = "SELECT * FROM consumer_info;";
    const [result] = await pool.execute(query);
    return response.status(200).json({ ok: true, consumers: result });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteCustomer = async (request, response) => {
  try {
    const query = "DELETE FROM consumer_info WHERE consumer_id=?";
    const values = [request.body.consumer_id];

    const [result] = await pool.execute(query, values);
    return response.status(200).json({ ok: true, consumer_deleted: result });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  consultingConsumerInfo,
  insertingCustomer,
  consultingConsumerTable,
  deleteCustomer,
};
