require("dotenv").config();
const { response } = require("express");
const getConnection = require("../database/config");
const { chunkArray } = require("../../helpers/chunkArray");

// Rows per statement for bulk writes -- see updateGroupItems.
const BULK_UPDATE_BATCH_SIZE = 500;
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
    const filters = request.body;

    let query = "SELECT * FROM company_info";
    const values = [];

    if (Object.keys(filters).length > 0) {
      const whereClauses = Object.keys(filters).map(key => `\`${key}\` = ?`);
      query += ` WHERE ${whereClauses.join(" AND ")}`;
      values.push(...Object.values(filters));
    }

    const [result] = await connection.execute(query, values);
    return response.status(200).json({ ok: true, companies: result });
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
    const { company_id, ...updateFields } = request.body;

    if (!company_id) {
      return response
        .status(400)
        .json({ ok: false, msg: "company_id is required for this action." });
    }

    const fieldEntries = Object.entries(updateFields);
    if (fieldEntries.length === 0) {
      return response
        .status(400)
        .json({ ok: false, msg: "No fields to update provided." });
    }

    const setClause = fieldEntries.map(([key]) => `${key} = ?`).join(", ");
    const values = fieldEntries.map(([, value]) => value);

    const query = `UPDATE company_info 
      SET ${setClause}, update_at=NOW()
      WHERE company_id=?`;

    values.push(company_id);

    const [result] = await connection.execute(query, values);
    if (result.affectedRows > 0) {
      return response
        .status(200)
        .json({ ok: true, message: "Company updated successfully" });
    }
    return response
      .status(404)
      .json({ ok: false, message: "Company not found or no changes made." });
  } catch (error) {
    logger.error("Error:", error.message);
    response.status(500).json({ ok: false, msg: error.message });
  }
};

const updateGroupItems = async (request, response) => {
  const pool = getConnection();
  try {
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

    // Todos los campos del SET salvo serial_number son compartidos por todo el
    // batch (vienen de request.body, no del item individual). Por eso se puede
    // colapsar el loop de N UPDATEs en 1 solo, usando CASE/WHEN únicamente para
    // el campo que sí varía por fila.
    const validItems = copyData.filter((item) => item.item_id);

    if (validItems.length) {
      // Batched inside one transaction: an unbounded CASE/WHEN + IN (...) for
      // the whole copy (thousands of items) risks max_allowed_packet/parameter
      // limits and holds the request open for the whole write.
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        for (const batch of chunkArray(validItems, BULK_UPDATE_BATCH_SIZE)) {
          const first = batch[0];
          const serialCases = batch.map(() => "WHEN ? THEN ?").join(" ");
          const itemIdsPlaceholders = batch.map(() => "?").join(",");

          const query = `
            UPDATE item_inv
            SET serial_number = CASE item_id ${serialCases} END,
                category_name=?, item_group=?, cost=?, brand=?, descript_item=?, ownership=?,
                main_warehouse=?, warehouse=?, company=?, location=?, sub_location=?, current_location=?,
                extra_serial_number=?, company_id=?, return_date=?, update_at=?, enableAssignFeature=?,
                container=?, containerSpotLimit=?, image_url=?
            WHERE item_id IN (${itemIdsPlaceholders})`;

          const values = [
            ...batch.flatMap((item) => [item.item_id, item.serial_number]),
            first.category_name,
            first.item_group,
            first.cost,
            first.brand,
            first.descript_item,
            first.ownership,
            first.main_warehouse,
            first.warehouse,
            first.company,
            first.location,
            first.sub_location,
            first.current_location,
            JSON.stringify(first.extra_serial_number),
            first.company_id,
            first.return_date,
            first.update_at,
            first.enableAssignFeature,
            first.container,
            first.containerSpotLimit,
            first.image_url,
            ...batch.map((item) => item.item_id),
          ];

          await connection.execute(query, values);
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
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
