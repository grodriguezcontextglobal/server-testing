require("dotenv").config({ quiet: true });
const getConnection = require("../database/config");

const connection = getConnection();

const insertingRecordInEvent = async (request, response) => {
  try {
    const {
      email,
      serial_number,
      status,
      activity,
      payment_id,
      event,
      item_group,
      category_name,
    } = request.body;

    const query = `
      INSERT INTO record_event (item_id, consumer_id, status, activity, event, payment_id)
      SELECT
        ii.item_id,
        ci.consumer_id,
        ? AS status,
        ? AS activity,
        ? AS event,
        ? AS payment_id
      FROM item_invt AS ii
      JOIN consumer_info AS ci ON ci.email = ?
      WHERE ii.item_group = ? AND ii.category_name = ? AND ii.serial_number = ?`;

    const values = [
      status,
      activity,
      event,
      payment_id,
      email,
      item_group,
      category_name,
      serial_number,
    ];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      ok: true,
      msg: "Item inserted successfully into event",
      inserted_record: result.affectedRows,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const insertingRecordInEventRefactored = async (request, response) => {
  try {
    const renderStatus = (status) =>
      typeof status === "string" ? status : status ? "In-Use" : "Returned";

    let resultRowAffected = 0;
    const { groupingInventoryByGroupName, dataToStoreAsRecord, event } = request.body;

    const query = `
      INSERT INTO record_event (item_id, consumer_id, status, activity, event, payment_id)
      SELECT
        ii.item_id,
        ci.consumer_id,
        ? AS status,
        ? AS activity,
        ? AS event,
        ? AS payment_id
      FROM item_inv AS ii
      JOIN consumer_info AS ci ON ci.email = ?
      WHERE ii.item_group = ? AND ii.category_name = ? AND ii.serial_number = ?`;

    // Cada fila necesita su propio INSERT...SELECT (el JOIN matchea contra
    // item_inv/consumer_info con criterios distintos por registro, no se puede
    // colapsar a 1 sola query sin arriesgar el resultado del join). Se envuelve
    // en una transacción para que una falla a mitad de loop no deje records
    // parciales — antes cada INSERT quedaba confirmado individualmente.
    // `connection` a nivel de módulo es el Pool (getConnection().promise()),
    // que no expone beginTransaction/commit/rollback — solo una PoolConnection
    // individual los tiene, por eso hay que sacar una del pool para la transacción.
    const txConnection = await connection.getConnection();
    try {
      await txConnection.beginTransaction();
      try {
        for (const data of dataToStoreAsRecord) {
          const values = [
            renderStatus(data.device.status),
            data.device.status,
            event,
            data.paymentIntent,
            data.user,
            data.device.deviceType,
            groupingInventoryByGroupName[data.device.deviceType]?.at(-1)?.category,
            data.device.serialNumber,
          ];

          const [result] = await txConnection.execute(query, values);
          resultRowAffected += result.affectedRows;
        }
        await txConnection.commit();
      } catch (innerError) {
        await txConnection.rollback();
        throw innerError;
      }
    } finally {
      txConnection.release();
    }

    return response.status(201).json({
      ok: true,
      msg: "Records inserted successfully into event",
      inserted_record: resultRowAffected,
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
  insertingRecordInEvent,
  insertingRecordInEventRefactored,
};
