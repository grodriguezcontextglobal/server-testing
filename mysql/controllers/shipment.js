const getConnection = require("../database/config");
const logger = require("../../helpers/logger");
const { v4: uuidv4 } = require('uuid');

const createShipment = async (req, res) => {
  const { 
    event_id, 
    company_id,
    destination, 
    recipient_name, 
    authorizer_name, 
    courier, 
    tracking_number, 
    package_list 
  } = req.body;

  if (!event_id || !company_id || !destination || !recipient_name || !authorizer_name || !courier || !tracking_number || !Array.isArray(package_list) || package_list.length === 0) {
    return res.status(400).json({ ok: false, message: "Missing required fields." });
  }

  let connection;
  try {
    connection = await getConnection().getConnection();
    await connection.beginTransaction();

    const shipmentId = uuidv4();
    const shipmentQuery = `
      INSERT INTO company_shipments (shipment_id, event_id, company_id, destination, recipient_name, authorizer_name, courier, tracking_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `;
    await connection.query(shipmentQuery, [shipmentId, event_id, company_id, destination, recipient_name, authorizer_name, courier, tracking_number]);

    const updateNotesQuery = `
      UPDATE event_item_shipping
      SET notes = JSON_SET(COALESCE(notes, '{}'), '$.shipment_id', ?)
      WHERE event_id = ? AND item_id IN (?);
    `;
    await connection.query(updateNotesQuery, [shipmentId, event_id, package_list]);

    await connection.commit();
    res.status(201).json({ ok: true, message: "Shipment created successfully.", shipment_id: shipmentId });

  } catch (error) {
    if (connection) await connection.rollback();
    logger.error("Error creating shipment:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

const updateShipment = async (req, res) => {
  const { shipment_id } = req.params;
  const { ...updates } = req.body;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ ok: false, message: "No update fields provided." });
  }

  let connection;
  try {
    connection = await getConnection().getConnection();
    const allowedUpdates = ["destination", "recipient_name", "authorizer_name", "courier", "tracking_number", "status"];
    const fieldsToUpdate = Object.keys(updates).filter(field => allowedUpdates.includes(field));
    
    if (fieldsToUpdate.length === 0) {
      return res.status(400).json({ ok: false, message: "No valid update fields provided." });
    }

    const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(", ");
    const updateValues = fieldsToUpdate.map(field => updates[field]);

    const query = `UPDATE company_shipments SET ${setClause} WHERE shipment_id = ?`;
    const [result] = await connection.query(query, [...updateValues, shipment_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "Shipment not found." });
    }

    res.status(200).json({ ok: true, message: "Shipment updated successfully." });

  } catch (error) {
    logger.error("Error updating shipment:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

const deleteShipment = async (req, res) => {
  const { shipment_id } = req.params;
  let connection;
  try {
    connection = await getConnection().getConnection();
    const [result] = await connection.query("DELETE FROM company_shipments WHERE shipment_id = ?", [shipment_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "Shipment not found." });
    }

    res.status(200).json({ ok: true, message: "Shipment deleted successfully." });

  } catch (error) {
    logger.error("Error deleting shipment:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

const getShipments = async (req, res) => {
    const { company_id, ...filters } = req.body;
    if (!company_id) {
        return res.status(400).json({ ok: false, message: "company_id is a required field." });
    }

    let connection;
    try {
        connection = await getConnection().getConnection();
        const allowedFilters = ["event_id", "destination", "recipient_name", "authorizer_name", "courier", "tracking_number", "status"];
        const filterKeys = Object.keys(filters).filter(key => allowedFilters.includes(key));

        let whereClause = "WHERE cs.company_id = ?";
        const queryValues = [company_id];

        if (filterKeys.length > 0) {
            const filterConditions = filterKeys.map(key => `cs.${key} = ?`).join(" AND ");
            whereClause += ` AND ${filterConditions}`;
            queryValues.push(...filterKeys.map(key => filters[key]));
        }

        const query = `
            SELECT cs.*, GROUP_CONCAT(eis.item_id) as package_list
            FROM company_shipments cs
            LEFT JOIN event_item_shipping eis ON JSON_EXTRACT(eis.notes, '$.shipment_id') = cs.shipment_id
            ${whereClause}
            GROUP BY cs.shipment_id;
        `;

        const [rows] = await connection.query(query, queryValues);
        res.status(200).json({ ok: true, shipments: rows });

    } catch (error) {
        logger.error("Error retrieving shipments:", error.message);
        res.status(500).json({ ok: false, error: error.message });
    } finally {
        if (connection) connection.release();
    }
};

const retrievePackageList = async (req, res) => {
  let connection;
  try {
    connection = await getConnection().getConnection();
    const { package_list } = req.body;
    console.log(package_list)
    if (!package_list) {
        return res.status(400).json({ ok: false, message: "package_list is a required field." });
    }

    // The package_list is a string of comma-separated IDs. Split it into an array.
    const itemIds = package_list.map(id => id);

    if (itemIds.length === 0) {
        return res.status(400).json({ ok: false, message: "No valid item IDs provided in package_list." });
    }

    const placeholders = itemIds.map(() => '?').join(',');
    const query = `SELECT * FROM item_inv WHERE item_id IN (${placeholders})`;

    const [rows] = await connection.query(query, itemIds);

    res.status(200).json({ ok: true, items: rows });

  } catch (error) {
    logger.error("Error retrieving package list:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { createShipment, updateShipment, deleteShipment, getShipments, retrievePackageList };