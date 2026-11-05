require("dotenv").config();
const { createPool } = require("mysql2");
const getConnection = require("../database/config");
const { resolveCompanyContext } = require("../helpers/companyContext");

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

// Columnas reales de consumer_info (prod, 2026-10-19). Los nombres de columna
// salían de las claves del body tal cual (inyección SQL): ahora, 400.
const CONSUMER_INFO_COLUMNS = new Set([
  "consumer_id", "first_name", "last_name", "email", "phone_number", "create_at", "update_at",
]);

const consultingConsumerInfo = async (request, response) => {
  try {
    const pool = await getConnection();
    const fields = Object.keys(request.body ?? {});
    if (fields.length === 0) {
      return response.status(400).json({ ok: false, msg: "At least one filter is required." });
    }
    const invalid = fields.filter((k) => !CONSUMER_INFO_COLUMNS.has(k));
    if (invalid.length > 0) {
      return response.status(400).json({ ok: false, msg: `Invalid field(s): ${invalid.join(", ")}` });
    }
    const keys = fields.map((k) => `\`${k}\`=?`).join(" AND ");
    const values = fields.map((k) => request.body[k]);
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

/**
 * Comprueba que un consumidor pertenece a la compania verificada del llamante.
 *
 * `consumer_info` NO tiene `company_id`: la pertenencia es indirecta y va por la
 * asistencia a eventos, que es el unico vinculo que existe en el esquema:
 *
 *   consumer_info.consumer_id
 *     -> consumer_attending_event.consumer_attending_id
 *     -> consumer_attending_event.event_attended_id = event_info.event_id
 *     -> event_info.company_assigned_event_id
 *
 * LIMITACION CONOCIDA, y es del esquema, no de esta comprobacion: un consumidor
 * que no asista a ningun evento de la compania no es alcanzable por esta ruta y
 * devuelve 404. No hay forma de atribuirlo a una compania con los datos que hay.
 * Antes tampoco se podia borrar —la ruta respondia 401 a todo—, asi que esto no
 * quita nada que funcionara; se documenta para que no parezca un bug.
 */
const consumerBelongsToCompany = async (pool, consumerId, companyId) => {
  const [[row]] = await pool.execute(
    `SELECT 1 AS found
       FROM consumer_attending_event cae
       JOIN event_info ei ON ei.event_id = cae.event_attended_id
      WHERE cae.consumer_attending_id = ? AND ei.company_assigned_event_id = ?
      LIMIT 1`,
    [consumerId, companyId]
  );
  return Boolean(row);
};

/**
 * Borra un consumidor.
 *
 * El `DELETE` era `WHERE consumer_id = ?` A SECAS: sin filtro de compania, el id
 * bastaba para borrar el consumidor de cualquier inquilino. No se habia notado
 * porque la ruta respondia 401 a TODA peticion —`authorizePermission` no
 * encontraba `company_id` en params, body ni query, y no miraba el header—, y al
 * arreglar eso la ruta despierta. Se le pone el scope ANTES de que despierte.
 *
 * El id se sigue leyendo del BODY primero, como hasta ahora, con `:id` de la URL
 * como respaldo: cambiar la precedencia movería a qué fila apunta una llamada que
 * mande las dos cosas distintas.
 */
const createDeleteCustomer = ({
  connectionFn = getConnection,
  resolveCompanyContextFn = resolveCompanyContext,
} = {}) => async (request, response) => {
  try {
    const context = await resolveCompanyContextFn(request);
    if (!context.ok) {
      return response.status(context.status).json({ ok: false, msg: context.msg });
    }

    const consumerId = request.body?.consumer_id ?? request.params?.id;
    if (!consumerId) {
      return response.status(400).json({ ok: false, msg: "consumer_id is required" });
    }

    const pool = await connectionFn();

    // 404 y no 403: un 403 confirmaria que ese consumer_id existe, que es
    // informacion de otro inquilino.
    if (!(await consumerBelongsToCompany(pool, consumerId, context.companyId))) {
      return response.status(404).json({ ok: false, msg: "Consumer not found" });
    }

    const query = "DELETE FROM consumer_info WHERE consumer_id=?";
    const [result] = await pool.execute(query, [consumerId]);
    return response.status(200).json({ ok: true, consumer_deleted: result });
  } catch (error) {
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteCustomer = createDeleteCustomer();

module.exports = {
  consultingConsumerInfo,
  insertingCustomer,
  consultingConsumerTable,
  deleteCustomer,
  createDeleteCustomer,
};
