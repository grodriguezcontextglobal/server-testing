require("dotenv").config();
const { response } = require("express");
const getConnection = require("../database/config");
const logger = require("../../helpers/logger");
const { groupBy } = require("lodash");

const insertingCompany = async (request, response) => {
  try {
    const connection = await getConnection();
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

    const query = `INSERT INTO company_info
      (company_name, street_address, city_address, state_address, zip_address, phone_number, email_company, industry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

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

    const [result] = await connection.execute(query, values);
    return response.status(201).json({ ok: true, company: result });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingCompany = async (request, response) => {
  try {
    const connection = await getConnection();
    const reference = Object.entries(request.body);
    const query = `SELECT * FROM company_info WHERE \`${reference[0][0]}\` = ?`;
    const values = [reference[0][1]];
    const [result] = await connection.execute(query, values);
    return response.status(200).json({ ok: true, company: result });
  } catch (err) {
    logger.error("Error:", err.message);
    return response.status(500).json({ ok: false, msg: err.message });
  }
};

const deleteCompany = async (request, response) => {
  try {
    const connection = await getConnection();
    const query = "DELETE FROM company_info WHERE company_id=?";
    const values = [request.body.company_id];
    const [result] = await connection.execute(query, values);
    return response.status(200).json({ ok: true, company_deleted: result });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingCompanyTable = async (request, response) => {
  try {
    const connection = await getConnection();
    const query = "SELECT * FROM company_info;";
    const [result] = await connection.execute(query);
    return response.status(200).json({ ok: true, companies: result });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingIndustryCompanyTable = async (request, response) => {
  try {
    const connection = await getConnection();
    const query = "SELECT industry FROM company_info ORDER BY industry;";
    const [result] = await connection.execute(query);
    const query1 =
      "SELECT industry_name FROM industry_list ORDER BY industry_name;";
    const [result1] = await connection.execute(query1);
    // Extract and normalize industry names from both sources
    const industriesFromCompanies = Array.isArray(result)
      ? result
          .map((row) =>
            row && row.industry ? String(row.industry).trim() : ""
          )
          .filter((v) => v && v.length)
      : [];

    const industriesFromList = Array.isArray(result1)
      ? result1
          .map((row) =>
            row && row.industry_name ? String(row.industry_name).trim() : ""
          )
          .filter((v) => v && v.length)
      : [];

    // Unique sets
    const uniqueCompanyIndustries = Array.from(
      new Set(industriesFromCompanies)
    );
    const uniqueListedIndustries = Array.from(new Set(industriesFromList));

    // Merge and dedupe
    const combined = Array.from(
      new Set([...uniqueCompanyIndustries, ...uniqueListedIndustries])
    );

    // Sort for stable output
    const collator = new Intl.Collator("en", { sensitivity: "base" });
    combined.sort(collator.compare);
    uniqueCompanyIndustries.sort(collator.compare);
    uniqueListedIndustries.sort(collator.compare);

    return response.status(200).json({
      ok: true,
      industry: combined,
      totalResult: {
        totalCompany: uniqueCompanyIndustries,
        totalIndustry: uniqueListedIndustries,
      },
    });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const updateCompanyData = async (request, response) => {
  try {
    const connection = await getConnection();
    const values = Object.values(request.body);
    const query = `UPDATE company_info 
      SET company_name=?, street_address=?, city_address=?, state_address=?, zip_address=?, 
          phone_number=?, email_company=?, update_at=NOW()
      WHERE company_id=?`;

    const [result] = await connection.execute(query, values);
    return response.status(200).json({ ok: true, items: result.affectedRows });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const updateGroupItems = async (request, response) => {
  try {
    const connection = await getConnection();
    const {
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      main_warehouse,
      warehouse,
      company,
      location,
      sub_location,
      current_location,
      extra_serial_number,
      company_id,
      return_date,
      update_at,
      enableAssignFeature = 1,
      container,
      containerSpotLimit,
      image_url,
      data,
    } = request.body;

    const copyData = JSON.parse(data).map((item) => ({
      ...item,
      category_name,
      item_group,
      cost,
      brand,
      descript_item,
      ownership,
      main_warehouse,
      warehouse,
      company,
      location,
      sub_location,
      current_location,
      extra_serial_number,
      company_id,
      return_date,
      update_at,
      enableAssignFeature,
      container,
      containerSpotLimit,
      image_url,
    }));

    const query = `
      UPDATE item_inv
      SET serial_number=?, category_name=?, item_group=?, cost=?, brand=?, descript_item=?, ownership=?,
          main_warehouse=?, warehouse=?, company=?, location=?, sub_location=?, current_location=?, 
          extra_serial_number=?, company_id=?, return_date=?, update_at=?, enableAssignFeature=?, 
          container=?, containerSpotLimit=?, image_url=?
      WHERE item_id=?`;

    for (const item of copyData) {
      if (!item.item_id) continue;

      const values = [
        item.serial_number,
        item.category_name,
        item.item_group,
        item.cost,
        item.brand,
        item.descript_item,
        item.ownership,
        item.main_warehouse,
        item.warehouse,
        item.company,
        item.location,
        item.sub_location,
        item.current_location,
        JSON.stringify(item.extra_serial_number),
        item.company_id,
        item.return_date,
        item.update_at,
        item.enableAssignFeature,
        item.container,
        item.containerSpotLimit,
        item.image_url,
        item.item_id,
      ];

      await connection.execute(query, values);
    }

    return response
      .status(200)
      .json({ ok: true, msg: "Items updated successfully" });
  } catch (error) {
    logger.error("Error in updateGroupItems controller:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
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
