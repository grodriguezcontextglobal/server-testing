const { response, request } = require("express");
const { createConnection } = require("mysql2");
const getConnection = require("../database/config");
require("dotenv").config();
const connection = getConnection();

// createConnection({
//   connectionLimit: 100,
//   host: "aws.connect.psdb.cloud",
//   user: "lypzlon9pede4sd8l2sx",
//   password: "pscale_pw_fFRrYmw5LhxWIT9mPLlRol7l4E9mJuLKfEws2r3kcNx",
//   database: "devitrak_db",
//   ssl: {
//     rejectUnauthorized: false,
//   },
// })

const EVENT_INFO_COLUMNS = new Set([
  "event_id",
  "event_name",
  "venue_name",
  "street_address",
  "city_address",
  "state_address",
  "zip_address",
  "email_company",
  "phone_number",
  "company_assigned_event_id",
  "configuration",
]);

const insertingEvent = async (request, response) => {
  try {
    const {
      event_name,
      venue_name,
      street_address,
      city_address,
      state_address,
      zip_address,
      email_company,
      phone_number = "000-000-0000",
      company_assigned_event_id,
    } = request.body;
    const query = `insert into event_info
        (event_name, venue_name, street_address, city_address, state_address, zip_address, email_company,  phone_number, company_assigned_event_id ) 
        values(?,?,?,?,?,?,?,?,?)`;
    const values = [
      event_name,
      venue_name,
      street_address,
      city_address,
      state_address,
      zip_address,
      email_company,
      phone_number,
      company_assigned_event_id
    ];
    const [result] = await connection.execute(query, values);
    // , function (err, result, fields) {
      // if (err)
      //   return response.status(500).json({
      //     ok: false,
      //     msg: `${err.message}`,
      //   });

      return response.status(201).json({
        ok: true,
        consumer: result,
      });
    // });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const updateEventInfo = async (request, response) => {
  const { event_id } = request.params;
  const updates = request.body;

  if (!event_id) {
    return response.status(400).json({
      ok: false,
      msg: "Event ID is required as a URL parameter.",
    });
  }

  if (Object.keys(updates).length === 0) {
    return response.status(400).json({
      ok: false,
      msg: "No update data provided in the request body.",
    });
  }

  const pool = getConnection();
  let connection;

  try {
    connection = await pool.getConnection();

    const invalidCols = Object.keys(updates).filter((k) => !EVENT_INFO_COLUMNS.has(k));
    if (invalidCols.length > 0) {
      return response.status(400).json({ ok: false, msg: `Invalid field(s): ${invalidCols.join(", ")}` });
    }

    const setClauses = Object.keys(updates)
      .map((key) => `\`${key}\` = ?`)
      .join(", ");
    const values = [...Object.values(updates), event_id];

    const query = `UPDATE event_info SET ${setClauses} WHERE event_id = ?`;

    const [result] = await connection.execute(query, values);

    if (result.affectedRows === 0) {
      return response.status(404).json({
        ok: false,
        msg: `No event found with ID ${event_id}, or data is the same.`,
      });
    }

    return response.status(200).json({
      ok: true,
      msg: `Event ${event_id} updated successfully.`,
      data: result,
    });
  } catch (error) {
    console.error("Error updating event:", error.message);
    return response.status(500).json({
      ok: false,
      msg: "An internal error occurred while updating the event.",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const consultingEventInformation = async (request, response) => {
  try {
    const invalidCols = Object.keys(request.body).filter((k) => !EVENT_INFO_COLUMNS.has(k));
    if (invalidCols.length > 0) {
      return response.status(400).json({ ok: false, msg: `Invalid field(s): ${invalidCols.join(", ")}` });
    }
    const formatting = Object.keys(request.body).map((item) => `\`${item}\`=?`);
    const keys = formatting.join(" AND ");
    const values = Object.values(request.body);

    const query = `select * from event_info where ${keys}`;
    const [result] = await connection.execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });

      return response.status(201).json({
        ok: true,
        event: result,
      });
    // });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const consultingEventTable = async (request, response) => {
  try {
    const invalidCols = Object.keys(request.body).filter((k) => !EVENT_INFO_COLUMNS.has(k));
    if (invalidCols.length > 0) {
      return response.status(400).json({ ok: false, msg: `Invalid field(s): ${invalidCols.join(", ")}` });
    }
    const formatting = Object.keys(request.body).map((item) => `\`${item}\`=?`);
    const keys = formatting.join(" AND ");
    const values = Object.values(request.body);
    const query = `select * from event_info where ${keys};`;
    // const valu es = [event_name, zip_address];
    const [result] = await connection.execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });

      return response?.status(201)?.json({
        ok: true,
        events: result,
      });
    // });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const consultingEventsPerCompany = async (request, response) => {
  try {
    const query = `select ei.*, ci.company_name from event_info ei 
        join company_info ci on ci.company_id = ei.company_assigned_event_id 
        where ci.company_id = ?;`;
    const values = [request.body];
    const [result] = await connection.execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });

      return response?.status(201)?.json({
        ok: true,
        events: result,
      });
    // });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const deleteEvent = async (request, response) => {
  try {
    const query = "delete from event_info where event_id=?";
    const values = [request.body.email];
    const [result] = await connection.execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });

      return response?.status(201)?.json({
        ok: true,
        consumer_deleted: result,
      });
    // });
  } catch (error) {
    console.error("Error:", error.message);
  }
};

const insertingStaffInEvent = async (request, response) => {
  try {
    const query = `
        insert into staff_event (event_id, staff_id, role)
        values(?,?,?)
        `;
    const values = [
      request.body.event_id,
      request.body.staff_id,
      `${request.body.role}`,
    ];
   const [result] = await connection.execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });

      return response?.status(201)?.json({
        ok: true,
        result: result,
      });
    // });
  } catch (error) {
    console.error("Error:", error.message);
  }
};

const consultingInventoryEvent = async (request, response) => {
  try {
    const connection = getConnection();
    const event_id = request.params.id;
    const query = `
        SELECT ii.* , iiae.status, iiae.condition, ei.event_name
        FROM item_inv ii
        LEFT JOIN item_inv_assigned_event iiae ON iiae.item_id = ii.item_id
        LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
        WHERE iiae.event_id = ?
        ORDER by ii.update_at ASC
        `;
    const values = [event_id];
    const [result] = await connection.execute(query, values);
    // , function (err, result, fields) {
    //   if (err)
    //     return response.status(500).json({
    //       ok: false,
    //       msg: `${err.message}`,
    //     });

      return response.status(201).json({
        ok: true,
        result,
      });
    // });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const updateStatusItemBasedOnEvent = async (request, response) => {
  const { event_id, update_at, status } = request.body;
  let errorRef = [];
  let itemRef = [];
  const ref = Object.entries(status);
  for (let [key, value] of ref) {
    for (let item of value) {
      const query = `
            UPDATE item_inv_assigned_event iiae
            JOIN item_inv ii ON iiae.item_id = ii.item_id
            SET iiae.status = ?, iiae.condition = ?, iiae.updated_at = ?, active = false
            WHERE ii.serial_number = ?
            AND iiae.event_id = ?;
          `;
      const values = [key, key, update_at, item.device, event_id];
      await connection.execute(query, values);
      // , function (err, result, fields) {
      //   if (err) {
      //     errorRef.push({ item: item.device, error: err });
      //   } else {
          itemRef.push({ item: item.device, status: key });
      //   }
      // });
    }
  }
  response.status(200).json({
    ok: true,
    msg: "updateStatusItemBasedOnEvent",
    error: errorRef,
    item: itemRef,
  });
};

module.exports = {
  consultingEventInformation,
  insertingEvent,
  updateEventInfo,
  consultingEventTable,
  deleteEvent,
  insertingStaffInEvent,
  consultingEventsPerCompany,
  consultingInventoryEvent,
  updateStatusItemBasedOnEvent,
};
