require("dotenv").config({ quiet: true });
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

// consultingCustomerInfo, consultingCustomerTable y deleteCustomer se borraron
// el 2026-10-21 (FedRAMP P1.11): ninguna ruta los montaba, y el primero armaba
// el nombre de columna con la clave del body (inyección SQL si alguien lo montaba).

module.exports = {
  insertingConsumerAttendingEvent,
  consultingCustomerAttendingEventsInfo,
  renderAllCustomerByEvent,
};
