const { response, request } = require("express");
const { createConnection } = require("mysql2");
const getConnection = require("../database/config");
const { readCompanyId } = require("../../middlewares/authorizePermission");
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

// DELETE /api/db_event/:id
//
// Leía el id de `request.body.email`. El dashboard (useDraftEventActions.jsx)
// manda el id en la URL y en el body el EMAIL del usuario, así que la consulta
// era `WHERE event_id = '<email>'` y no borraba nada: los borradores no se
// borraban nunca y la respuesta decía ok. Ahora el id sale de la URL.
//
// Y solo borra eventos de la compañía en la que authorizePermission comprobó el
// permiso (la misma que lee `readCompanyId`: params, body, query o la cabecera
// `s-company-lq`). Sin esto, con `event:delete` en una compañía se podía borrar
// el evento de otra conociendo su id.
const deleteEvent = async (request, response) => {
  try {
    const eventId = request.params.id;
    const companyId = readCompanyId(request);
    if (!eventId || !/^\d+$/.test(String(eventId))) {
      return response.status(400).json({ ok: false, msg: "A numeric event id is required in the URL." });
    }
    if (!companyId) {
      return response.status(400).json({ ok: false, msg: "Company context is required." });
    }

    const query =
      "DELETE FROM event_info WHERE event_id = ? AND company_assigned_event_id = ?";
    const [result] = await connection.execute(query, [String(eventId), String(companyId)]);

    if (!result.affectedRows) {
      // Ni de esta compañía ni existente: no se distingue a propósito.
      return response.status(404).json({ ok: false, msg: "Event not found." });
    }

    return response.status(200).json({
      ok: true,
      event_id: Number(eventId),
      deleted: result.affectedRows,
    });
  } catch (error) {
    console.error("Error:", error.message);
    // Un evento con inventario, staff o registros todavía asociados no se puede
    // borrar: se dice qué pasa en vez de un 500 genérico.
    if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED") {
      return response.status(409).json({
        ok: false,
        msg: "The event still has inventory, staff or records attached. Remove them first.",
      });
    }
    // Sin respuesta aquí, el middleware de timeout contesta 408 y tapa el error real
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
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
    // Sin respuesta aquí, el middleware de timeout contesta 408 y tapa el error real
    const status = error.code === "ER_DUP_ENTRY" ? 409 : 500;
    response.status(status).json({
      ok: false,
      msg: `${error.message}`,
    });
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
