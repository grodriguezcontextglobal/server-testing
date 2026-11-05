require("dotenv").config();
const getConnection = require("../database/config");

const connection = getConnection();

const insertingStripeCustomer = async (request, response) => {
  try {
    const { stripe_id, company_id } = request.body;
    const query = `
      INSERT INTO stripe_info (stripe_id, company_id)
      VALUES (?, ?)`;
    const values = [stripe_id, company_id];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      ok: true,
      stripe: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

// La columna salía de la clave del body; las comillas invertidas no bastaban
// (una clave con una comilla invertida dentro las cierra). Solo columnas reales.
const STRIPE_INFO_COLUMNS = new Set(["stripe_id", "company_id", "created_at"]);

const consultingStripeCustomer = async (request, response) => {
  try {
    const reference = Object.entries(request.body ?? {});
    if (!reference.length) {
      return response.status(400).json({
        ok: false,
        msg: "Missing search field",
      });
    }
    if (!STRIPE_INFO_COLUMNS.has(reference[0][0])) {
      return response.status(400).json({ ok: false, msg: `Invalid field: ${reference[0][0]}` });
    }

    const query = `SELECT * FROM stripe_info WHERE \`${reference[0][0]}\` = ?`;
    const values = [reference[0][1]];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      stripe: result,
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
  insertingStripeCustomer,
  consultingStripeCustomer,
};
