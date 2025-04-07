require("dotenv").config();
const { response } = require("express");
const getConnection = require("../database/config");
const insertingCompany = (request, response) => {
  try {
    const connection = getConnection();
    const {
      company_name,
      street_address,
      city_address,
      state_address,
      zip_address,
      phone_number,
      email_company,
      industry,
    } = request.body;
    const query = `insert into company_info
        (company_name, street_address, city_address, state_address, zip_address, phone_number, email_company, industry)
        values(?,?,?,?,?,?,?,?)`;

    const values = [
      company_name,
      street_address,
      city_address,
      state_address,
      zip_address,
      phone_number,
      email_company,
      industry,
    ];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });
      return response.status(201).json({
        ok: true,
        company: result,
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

const consultingCompany = async (request, response) => {
  const connection = getConnection();
  const reference = Object.entries(request.body);
  const query = `SELECT * FROM company_info WHERE \`${reference[0][0]}\` = ?`;
  const values = [reference[0][1]];

  try {
    const [result] = await connection.promise().execute(query, values);
    return response.status(200).json({
      ok: true,
      company: result,
    });
  } catch (err) {
    console.error("Error:", err.message);
    return response.status(500).json({
      ok: false,
      msg: err.message,
    });
  }
};

const deleteCompany = async () => {
  try {
    const connection = getConnection();
    const query = "delete from company_info where company_id=?";
    const values = [request.body.company_id];
    connection.execute(query, values, function (err, result, fields) {
      if (err)
        return response.status(500).json({
          ok: false,
          msg: `${err.message}`,
        });

      return response?.status(201)?.json({
        ok: true,
        company_deleted: result,
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
  }
};

const consultingCompanyTable = async (request, response) => {
  try {
    const connection = getConnection();
    const query = "select * from company_info;";
    const values = [];
    const [error, result] = await connection.promise().execute(query, values);
    // connection.execute(query, values, function (err, result, fields) {
    if (error)
      return response.status(500).json({
        ok: false,
        msg: `${error.message}`,
      });

    //   });
    return response?.status(201)?.json({
      ok: true,
      companies: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const consultingIndustryCompanyTable = async (request, response) => {
  try {
    const connection = getConnection();
    const query = "select industry from company_info;";
    const values = [];
    const [error, result] = await connection.promise().execute(query, values);
    // connection.execute(query, values, function (err, result, fields) {
    // });
    if (error)
      return response.status(500).json({
        ok: false,
        msg: `${error.message}`,
      });

    return response?.status(201)?.json({
      ok: true,
      industry: result,
    });
  } catch (error) {
    console.error("Error:", error.message);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

const updateCompanyData = async (request, response) => {
  try {
    const connection = getConnection();
    const values = [...Object.values(request.body).map((item) => item)];
    const query = `UPDATE company_info 
                            SET company_name=?,
                                street_address=?,
                                city_address=?,
                                state_address=?,
                                zip_address=?,
                                phone_number=?,
                                email_company=?,
                                update_at=NOW()
                            WHERE company_id=?`;
    // const [err, result] = await connection.promise().execute(query, values);
    connection.execute(query, values, function (err, result, fields) {
      if (err) {
        console.log("error", err);
        return response.status(401).json({
          ok: false,
          msg: `${err}`,
        });
      }
      return response.status(201).json({
        ok: true,
        items: result.affectedRows,
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

const updateGroupItems = async (request, response) => {
  try {
    const connection = getConnection();
    const {
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      main_warehouse,
      update_at,
      location,
      current_location,
      extra_serial_number,
      return_date,
      enableAssignFeature,
      data,
    } = request.body;

    // Parse the data from the request body
    const copyData = JSON.parse(data).map((item) => {
      return {
        ...item,
        category_name,
        item_group,
        cost,
        brand,
        descript_item,
        ownership,
        main_warehouse,
        update_at,
        location,
        current_location,
        extra_serial_number,
        return_date,
        enableAssignFeature,
        item_id: item.item_id,
      };
    });

    const query = `
      UPDATE item_inv
      SET
        category_name=?,
        item_group=?,
        cost=?,
        brand=?,
        descript_item=?,
        ownership=?,
        main_warehouse=?,
        update_at=?,
        location=?,
        current_location=?,
        extra_serial_number=?,
        return_date=?,
        enableAssignFeature=?
      WHERE item_id=?`;

    // Execute updates for each item individually
    for (const item of copyData) {
      // Check if item_id is valid
      if (!item.item_id) {
        continue;
      }

      const values = [
        item.category_name,
        item.item_group,
        item.cost,
        item.brand,
        item.descript_item,
        item.ownership,
        item.main_warehouse,
        item.update_at,
        item.location,
        item.current_location,
        item.extra_serial_number,
        item.return_date,
        item.enableAssignFeature,
        item.item_id,
      ];

      // Use a Promise to wait for the query to complete
      await new Promise((resolve, reject) => {
        connection.query(query, values, function (err, result) {
          if (err) {
            return reject(err);
          }

          // Log the result to verify the affected rows
          resolve(result);
        });
      });
    }

    return response.status(200).json({
      ok: true,
      msg: "Items updated successfully",
    });
  } catch (error) {
    console.error("Error in updateGroupItems controller:", error);
    response.status(500).json({
      ok: false,
      msg: `${error.message}`,
    });
  }
};

module.exports = {
  consultingCompany,
  insertingCompany,
  consultingCompanyTable,
  deleteCompany,
  consultingIndustryCompanyTable,
  updateCompanyData,
  updateGroupItems,
};
