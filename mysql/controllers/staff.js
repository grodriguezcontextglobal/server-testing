require("dotenv").config();
const getConnection = require("../database/config");

const connection = getConnection();

const insertingStaffMember = async (request, response) => {
  try {
    const { first_name, last_name, email, phone_number } = request.body;
    const query = `
      INSERT INTO staff_member (first_name, last_name, email, phone_number)
      VALUES (?, ?, ?, ?)`;
    const values = [first_name, last_name, email, phone_number];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      ok: true,
      member: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const consultingStaffMemberInformation = async (request, response) => {
  try {
    const formatting = Object.keys(request.body).map((item) => `${item}=?`).join(" AND ");
    const values = Object.values(request.body);
    const query = `SELECT * FROM staff_member WHERE ${formatting}`;

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      member: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const consultingEventTable = async (request, response) => {
  try {
    const { event_name, zip_address } = request.body;
    const query = `SELECT * FROM event_info WHERE event_name = ? AND zip_address = ?`;
    const values = [event_name, zip_address];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      events: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const deleteEvent = async (request, response) => {
  try {
    const { event_id } = request.body;
    const query = `DELETE FROM event_info WHERE event_id = ?`;
    const values = [event_id];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      deleted: result.affectedRows,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

module.exports = {
  insertingStaffMember,
  consultingStaffMemberInformation,
  consultingEventTable,
  deleteEvent,
};
