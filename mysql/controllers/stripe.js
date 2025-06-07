const { response, request } = require("express");
const { createConnection } = require("mysql2");
const getConnection = require("../database/config");
require("dotenv").config();

const connection = getConnection();

const insertingStripeCustomer = (request, response) => {
  try {
    const { stripe_id, company_id } = request.body;
    const query = `insert into stripe_info
        (stripe_id, company_id )
        values(?,?)`;
    const values = [`${stripe_id}`, `${company_id}`];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });

      return response.status(201).json({
        ok: true,
        stripe: result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const consultingStripeCustomer = async (request, response) => {
  try {
    const reference = Object.entries(request.body);
    const query = `select * from stripe_info where \`${reference[0][0]}\`=?`;
    const values = [`${reference[0][1]}`];
    const [result] = await connection.execute(query, values);
    if (!result)
      return response.status(500).json({
        ok: false,
        msg: `Something went wrong`,
      });
    return response.status(201).json({
      ok: true,
      stripe: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

module.exports = {
  insertingStripeCustomer,
  consultingStripeCustomer,
};
