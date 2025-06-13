require("dotenv").config();
const getConnection = require("../database/config");

const connection = getConnection();

const insertingConsumerAttendingEvent = async (request, response) => {
  try {
    const { consumer_attending_id, event_attended_id } = request.body;
    const query = `
      INSERT INTO consumer_attending_event (consumer_attending_id, event_attended_id) 
      VALUES (?, ?)`;
    const values = [consumer_attending_id, event_attended_id];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      ok: true,
      customer: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingCustomerAttendingEventsInfo = async (request, response) => {
  try {
    const query = `
      SELECT 
        s.first_name AS Consumers_First_Name, 
        s.last_name AS Consumers_Last_Name, 
        s.email AS Consumers_Email, 
        c.event_name AS Event
      FROM consumer_info s
      INNER JOIN consumer_attending_event b ON s.consumer_id = b.consumer_attending_id
      INNER JOIN event_info c ON b.event_attended_id = c.event_id
      ORDER BY s.first_name`;

    const [result] = await connection.execute(query);

    return response.status(200).json({
      ok: true,
      customers: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const renderAllCustomerByEvent = async (request, response) => {
  try {
    const query = `
      SELECT 
        s.first_name AS Consumers_First_Name, 
        s.last_name AS Consumers_Last_Name, 
        s.email AS Consumers_Email, 
        c.event_name AS Event 
      FROM consumer_info s
      INNER JOIN consumer_attending_event b ON s.consumer_id = b.consumer_attending_id
      INNER JOIN event_info c ON b.event_attended_id = ? AND c.event_id = ?`;

    const values = [request.body.event, request.body.event];
    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      customer: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingCustomerInfo = async (request, response) => {
  try {
    const reference = Object.entries(request.body);
    const query = `
      SELECT * FROM company_attending_event 
      WHERE \`${reference[0][0]}\` = ?`;
    const values = [reference[0][1]];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      customer: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingCustomerTable = async (request, response) => {
  try {
    const query = "SELECT * FROM consumer_attending_event";
    const [result] = await connection.execute(query);

    return response.status(200).json({
      ok: true,
      customers: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteCustomer = async (request, response) => {
  try {
    const query = "DELETE FROM consumer_info WHERE consumer_id = ?";
    const values = [request.body.consumer_id];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      customer_deleted: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  consultingCustomerInfo,
  insertingConsumerAttendingEvent,
  consultingCustomerTable,
  deleteCustomer,
  consultingCustomerAttendingEventsInfo,
  renderAllCustomerByEvent,
};
