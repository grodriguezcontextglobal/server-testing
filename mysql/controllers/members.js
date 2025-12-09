require("dotenv").config();
const logger = require("../../helpers/logger");
const getConnection = require("../database/config");
const connection = getConnection();

const insertNewMember = async (request, response) => {
  try {
    const body = request.body || {};
logger.info("body", body)
    // Normalize name fields: support `name` or `first_name`/`last_name`
    let first_name = body.first_name
      ? String(body.first_name).trim()
      : undefined;
    let last_name = body.last_name ? String(body.last_name).trim() : undefined;
    if (!first_name || !last_name) {
      const fullName = body.name ? String(body.name).trim() : "";
      if (fullName) {
        const parts = fullName.split(/\s+/);
        if (!first_name)
          first_name =
            parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
        if (!last_name)
          last_name = parts.length > 1 ? parts[parts.length - 1] : "";
      }
    }

    // Normalize address fields: support `address` OR split address parts
    let address = body.address ? String(body.address).trim() : undefined;
    let address_street = body.address_street
      ? String(body.address_street).trim()
      : undefined;
    let address_city = body.address_city
      ? String(body.address_city).trim()
      : undefined;
    let address_state = body.address_state
      ? String(body.address_state).trim()
      : undefined;
    let address_zip = body.address_zip
      ? String(body.address_zip).trim()
      : undefined;

    // If full address provided, attempt to split into components
    if (
      address &&
      (!address_street || !address_city || !address_state || !address_zip)
    ) {
      const byComma = address
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (byComma.length >= 3) {
        // Common format: Street, City, State Zip
        address_street = address_street || byComma[0];
        address_city = address_city || byComma[1];
        const stateZip = byComma.slice(2).join(" ");
        const m = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(-\d{4})?)$/);
        if (m) {
          address_state = address_state || m[1];
          address_zip = address_zip || m[2];
        } else {
          // Fallback: last token as zip if it looks like zip
          const tokens = stateZip.split(/\s+/);
          const last = tokens[tokens.length - 1];
          if (/^\d{5}(-\d{4})?$/.test(last)) {
            address_zip = address_zip || last;
            address_state = address_state || tokens.slice(0, -1).join(" ");
          } else {
            address_state = address_state || stateZip; // couldn't parse zip cleanly
          }
        }
      }
    }

    // If split parts provided but full address missing, compose it
    if (!address) {
      const composed = [
        address_street,
        address_city,
        [address_state, address_zip].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ");
      address = composed || undefined;
    }

    // Collect allowed columns dynamically
    const allowed = {
      first_name,
      last_name,
      email: body.email ? String(body.email).trim() : undefined,
      phone_number:
        body.phone_number ?? body.phone ?? body.phoneNumber
          ? String(body.phone_number ?? body.phone ?? body.phoneNumber).trim()
          : undefined,
      address,
      address_street,
      address_city,
      address_state,
      address_zip,
      company_id: body.company_id ? String(body.company_id).trim() : undefined,
    };

    const columns = Object.keys(allowed).filter(
      (k) => allowed[k] !== undefined
    );
    if (columns.length === 0) {
      return response
        .status(400)
        .json({ message: "No valid fields provided to insert." });
    }

    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map((k) => allowed[k]);
    const query = `INSERT INTO members_info (${columns.join(
      ", "
    )}) VALUES (${placeholders})`;

    const [result] = await connection.query(query, values);
    logger.info(`Member inserted with ID: ${result.insertId}`);
    return response.status(201).json({
      ok: true,
      message: "Member inserted successfully",
      memberId: result.insertId,
      inserted_fields: columns,
    });
  } catch (error) {
    logger.error(`Error inserting member: ${error.message}`);
    return response.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

const insertBulkMembers = async (request, response) => {
  try {
    const body = request.body || {};
    logger.info("body", body);
    const input = Array.isArray(body.rows)
      ? body.rows
      : Array.isArray(body.members)
      ? body.members
      : Array.isArray(body.list)
      ? body.list
      : Array.isArray(body.data)
      ? body.data
      : [];
    logger.info("input", input);
    if (!input.length) {
      return response.status(400).json({
        ok: false,
        msg: "Provide an array of members to insert (rows/members/list/data).",
      });
    }

    const normalize = (r) => {
      let first_name = r.first_name ?? r.firstName;
      let last_name = r.last_name ?? r.lastName;

      if ((!first_name || !last_name) && r.name) {
        const parts = String(r.name).trim().split(/\s+/);
        if (!first_name)
          first_name =
            parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
        if (!last_name)
          last_name = parts.length > 1 ? parts[parts.length - 1] : "";
      }

      first_name =
        first_name !== undefined && first_name !== null
          ? String(first_name).trim()
          : undefined;
      last_name =
        last_name !== undefined && last_name !== null
          ? String(last_name).trim()
          : undefined;

      let address = r.address ? String(r.address).trim() : undefined;
      let address_street = r.address_street ?? r.street ?? r.addressStreet;
      let address_city = r.address_city ?? r.city ?? r.addressCity;
      let address_state = r.address_state ?? r.state ?? r.addressState;
      let address_zip = r.address_zip ?? r.zip ?? r.postalCode ?? r.addressZip;

      address_street =
        address_street !== undefined && address_street !== null
          ? String(address_street).trim()
          : undefined;
      address_city =
        address_city !== undefined && address_city !== null
          ? String(address_city).trim()
          : undefined;
      address_state =
        address_state !== undefined && address_state !== null
          ? String(address_state).trim()
          : undefined;
      address_zip =
        address_zip !== undefined && address_zip !== null
          ? String(address_zip).trim()
          : undefined;

      if (
        address &&
        (!address_street || !address_city || !address_state || !address_zip)
      ) {
        const byComma = address
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (byComma.length >= 3) {
          address_street = address_street || byComma[0];
          address_city = address_city || byComma[1];
          const stateZip = byComma.slice(2).join(" ");
          const m = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(-\d{4})?)$/);
          if (m) {
            address_state = address_state || m[1];
            address_zip = address_zip || m[2];
          } else {
            const tokens = stateZip.split(/\s+/);
            const last = tokens[tokens.length - 1];
            if (/^\d{5}(-\d{4})?$/.test(last)) {
              address_zip = address_zip || last;
              address_state = address_state || tokens.slice(0, -1).join(" ");
            } else {
              address_state = address_state || stateZip;
            }
          }
        }
      }

      if (
        !address &&
        (address_street || address_city || address_state || address_zip)
      ) {
        const composed = [
          address_street,
          address_city,
          [address_state, address_zip].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ");
        address = composed || undefined;
      }

      const email = r.email ? String(r.email).trim() : undefined;
      const phone_number_raw = r.phone_number ?? r.phone ?? r.phoneNumber;
      const phone_number =
        phone_number_raw !== undefined && phone_number_raw !== null
          ? String(phone_number_raw).trim()
          : undefined;
      let company_id_raw = r.company_id ?? r.companyId;
      if (Array.isArray(company_id_raw)) {
        // Use first non-empty element if array provided
        const first = company_id_raw.find(
          (v) => v !== undefined && v !== null && String(v).trim().length
        );
        company_id_raw = first;
      }
      const company_id =
        company_id_raw !== undefined && company_id_raw !== null
          ? String(company_id_raw).trim()
          : undefined;

      return {
        first_name,
        last_name,
        email,
        phone_number,
        address,
        address_street,
        address_city,
        address_state,
        address_zip,
        company_id,
      };
    };

    const normalized = input.map(normalize);
    const valid = normalized.filter((r) => r.first_name && r.last_name);
    const skipped = normalized.length - valid.length;

    if (!valid.length) {
      return response.status(400).json({
        ok: false,
        msg: "No valid rows with first_name and last_name.",
        skipped,
      });
    }

    const baseOrder = [
      "first_name",
      "last_name",
      "email",
      "phone_number",
      "address",
      "address_street",
      "address_city",
      "address_state",
      "address_zip",
      "company_id",
    ];

    const present = new Set(["first_name", "last_name"]);
    for (const r of valid) {
      for (const k of baseOrder) if (r[k] !== undefined) present.add(k);
    }
    // Filter columns against actual table schema to avoid unknown column errors
    const [schemaRes] = await connection.query(
      "SHOW COLUMNS FROM members_info"
    );
    const schemaCols = new Set((schemaRes || []).map((c) => c.Field));
    const columns = baseOrder.filter(
      (k) => present.has(k) && schemaCols.has(k)
    );

    const rowPlaceholders = `(${columns.map(() => "?").join(", ")})`;
    const placeholders = valid.map(() => rowPlaceholders).join(", ");
    const values = [];
    for (const r of valid) {
      for (const c of columns) values.push(r[c] !== undefined ? r[c] : null);
    }

    const query = `INSERT INTO members_info (${columns.join(
      ", "
    )}) VALUES ${placeholders}`;
    logger.info(`Query: ${query}`);
    logger.info(`Values: ${values}`);
    const [result] = await connection.query(query, values);

    logger.info(
      `Bulk members inserted: requested=${input.length}, inserted=${valid.length}, skipped=${skipped}`
    );
    return response.status(201).json({
      ok: true,
      requested: input.length,
      inserted: valid.length,
      skipped,
      affectedRows: result.affectedRows || 0,
      insertId: result.insertId || null,
      columns,
    });
  } catch (error) {
    logger.error(`Error bulk inserting members: ${error.message}`);
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

// Dynamically update member fields using member_id as the identifier
const updateMemberInfo = async (request, response) => {
  try {
    const body = request.body || {};
    const member_id = body.member_id || body.memberId || body.id;
    if (!member_id) {
      return response.status(400).json({ message: "member_id is required." });
    }

    // Normalize name fields (if provided)
    let first_name = body.first_name
      ? String(body.first_name).trim()
      : undefined;
    let last_name = body.last_name ? String(body.last_name).trim() : undefined;
    if ((!first_name || !last_name) && body.name) {
      const fullName = String(body.name).trim();
      const parts = fullName.split(/\s+/);
      if (!first_name)
        first_name = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
      if (!last_name)
        last_name = parts.length > 1 ? parts[parts.length - 1] : "";
    }

    // Normalize address fields
    let address = body.address ? String(body.address).trim() : undefined;
    let address_street = body.address_street
      ? String(body.address_street).trim()
      : undefined;
    let address_city = body.address_city
      ? String(body.address_city).trim()
      : undefined;
    let address_state = body.address_state
      ? String(body.address_state).trim()
      : undefined;
    let address_zip = body.address_zip
      ? String(body.address_zip).trim()
      : undefined;

    // If full address provided, attempt to split into components
    if (
      address &&
      (!address_street || !address_city || !address_state || !address_zip)
    ) {
      const byComma = address
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (byComma.length >= 3) {
        address_street = address_street || byComma[0];
        address_city = address_city || byComma[1];
        const stateZip = byComma.slice(2).join(" ");
        const m = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(-\d{4})?)$/);
        if (m) {
          address_state = address_state || m[1];
          address_zip = address_zip || m[2];
        } else {
          const tokens = stateZip.split(/\s+/);
          const last = tokens[tokens.length - 1];
          if (/^\d{5}(-\d{4})?$/.test(last)) {
            address_zip = address_zip || last;
            address_state = address_state || tokens.slice(0, -1).join(" ");
          } else {
            address_state = address_state || stateZip;
          }
        }
      }
    }

    // If split parts provided but full address missing, compose it
    if (
      !address &&
      (address_street || address_city || address_state || address_zip)
    ) {
      const composed = [
        address_street,
        address_city,
        [address_state, address_zip].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ");
      address = composed || undefined;
    }

    // Collect allowed columns to update
    const allowed = {
      first_name,
      last_name,
      email: body.email ? String(body.email).trim() : undefined,
      phone_number:
        body.phone_number ?? body.phone ?? body.phoneNumber
          ? String(body.phone_number ?? body.phone ?? body.phoneNumber).trim()
          : undefined,
      address,
      address_street,
      address_city,
      address_state,
      address_zip,
      company_id: body.company_id ? String(body.company_id).trim() : undefined,
    };

    const columns = Object.keys(allowed).filter(
      (k) => allowed[k] !== undefined
    );
    if (columns.length === 0) {
      return response
        .status(400)
        .json({ message: "No updatable fields provided." });
    }

    const setClause = columns.map((c) => `\`${c}\` = ?`).join(", ");
    const values = columns.map((k) => allowed[k]);
    const query = `UPDATE members_info SET ${setClause} WHERE member_id = ?`;
    values.push(String(member_id).trim());

    const [result] = await connection.query(query, values);
    return response.status(200).json({
      ok: true,
      updated_fields: columns,
      affectedRows: result.affectedRows || 0,
    });
  } catch (error) {
    logger.error(`Error updating member: ${error.message}`);
    return response
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

// Delete one or multiple members_info by member_id
const deleteMember = async (request, response) => {
  try {
    let { member_id, member_ids, ids } = request.body || {};

    // Normalize to array of ids
    let idList = [];
    if (Array.isArray(member_ids)) idList = member_ids;
    else if (Array.isArray(ids)) idList = ids;
    else if (Array.isArray(member_id)) idList = member_id;
    else if (member_id || ids) idList = [member_id || ids];

    idList = Array.from(
      new Set(
        (idList || [])
          .map((v) => (v !== undefined && v !== null ? String(v).trim() : ""))
          .filter((v) => v.length > 0)
      )
    );

    if (!idList.length) {
      return response
        .status(400)
        .json({ ok: false, msg: "member_id or member_ids is required." });
    }

    const placeholders = idList.map(() => "?").join(", ");
    const query = `DELETE FROM members_info WHERE member_id IN (${placeholders})`;
    const [result] = await connection.query(query, idList);

    return response.status(200).json({
      ok: true,
      requested: idList.length,
      affectedRows: result.affectedRows || 0,
    });
  } catch (error) {
    logger.error(`Error deleting member(s): ${error.message}`);
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

// Retrieve member info by dynamic filters (supports member_id and other columns)
const retrieveMemberInfo = async (request, response) => {
  try {
    const body = request.body || {};
    const normalizedBody = { ...body };
    if (normalizedBody.phone && !normalizedBody.phone_number) {
      normalizedBody.phone_number = normalizedBody.phone;
    }
    const allowedKeys = [
      "member_id",
      "first_name",
      "last_name",
      "email",
      "phone_number",
      "address",
      "address_street",
      "address_city",
      "address_state",
      "address_zip",
      "company_id",
    ];

    const filters = Object.entries(normalizedBody)
      .filter(
        ([k, v]) =>
          allowedKeys.includes(k) &&
          v !== undefined &&
          v !== null &&
          String(v).trim().length
      )
      .map(([k, v]) => [k, String(v).trim()]);

    if (!filters.length) {
      return response
        .status(400)
        .json({ ok: false, msg: "Provide at least one filter." });
    }

    const where = filters.map(([k]) => `\`${k}\` = ?`).join(" AND ");
    const values = filters.map(([, v]) => v);
    const query = `SELECT * FROM members_info WHERE ${where}`;

    const [rows] = await connection.query(query, values);
    return response.status(200).json({ ok: true, members: rows });
  } catch (error) {
    logger.error(`Error retrieving members: ${error.message}`);
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

module.exports = {
  insertNewMember,
  insertBulkMembers,
  updateMemberInfo,
  deleteMember,
  retrieveMemberInfo,
};
