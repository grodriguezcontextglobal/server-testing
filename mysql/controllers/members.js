require("dotenv").config();
// const logger = require("../../helpers/logger");
const getConnection = require("../database/config");
const connection = getConnection();

const insertNewMember = async (request, response) => {
  try {
    const body = request.body || {};
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
      company_id: body.company_id ? String(body.company_id).trim() : null,
      image_url: body.image_url ? String(body.image_url).trim() : null,
      external_id: body.external_id ? String(body.external_id).trim() : undefined,
      grade: body.grade ? String(body.grade).trim() : undefined,
      homeroom: body.homeroom ? String(body.homeroom).trim() : undefined,
      // School track: minor + guardian info must be settable at creation,
      // not only via update (guardian consent flows depend on it).
      minor:
        body.minor === undefined
          ? undefined
          : body.minor === true ||
            body.minor === 1 ||
            ["1", "true", "yes", "y"].includes(String(body.minor).toLowerCase().trim())
          ? 1
          : 0,
      parent_guardian_first_name: body.parent_guardian_first_name
        ? String(body.parent_guardian_first_name).trim()
        : undefined,
      parent_guardian_last_name: body.parent_guardian_last_name
        ? String(body.parent_guardian_last_name).trim()
        : undefined,
      parent_guardian_email: body.parent_guardian_email
        ? String(body.parent_guardian_email).trim()
        : undefined,
      parent_guardian_phone_number: body.parent_guardian_phone_number
        ? String(body.parent_guardian_phone_number).trim()
        : undefined,
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
    return response.status(201).json({
      ok: true,
      message: "Member inserted successfully",
      memberId: result.insertId,
      inserted_fields: columns,
    });
  } catch (error) {
    return response.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

const insertBulkMembers = async (request, response) => {
  try {
    const body = request.body || {};
    const input = Array.isArray(body.rows)
      ? body.rows
      : Array.isArray(body.members)
      ? body.members
      : Array.isArray(body.list)
      ? body.list
      : Array.isArray(body.data)
      ? body.data
      : [];
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
      let external_id = r.external_id ?? r.externalId;
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

      const image_url =
        body.image_url !== undefined || body.image_url !== null
          ? String(body.image_url).trim()
          : undefined;

      return {
        first_name,
        last_name,
        email,
        phone_number,
        external_id,
        address,
        address_street,
        address_city,
        address_state,
        address_zip,
        company_id,
        image_url,
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
      "external_id",
      "address",
      "address_street",
      "address_city",
      "address_state",
      "address_zip",
      "company_id",
      "grade",
      "homeroom",
      "minor",
      "parent_guardian_first_name",
      "parent_guardian_last_name",
      "parent_guardian_email",
      "parent_guardian_phone_number",
    ];

    // Coerce school-track fields from spreadsheet-style values
    for (const r of valid) {
      if (r.minor !== undefined) {
        r.minor =
          r.minor === true ||
          r.minor === 1 ||
          ["1", "true", "yes", "y"].includes(String(r.minor).toLowerCase().trim())
            ? 1
            : 0;
      }
    }

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
    const [result] = await connection.query(query, values);

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
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

// Retrieve rows from member_assigned_device_lease with optional filters
const retrieveMembersAssignedDevices = async (request, response) => {
  try {
    const body = request.body || {};
    const srcWhere =
      typeof body.where === "object" && body.where ? body.where : body;

    // Fetch actual table columns and constrain to allowed list
    const [schemaRes] = await connection.query(
      "SHOW COLUMNS FROM member_assigned_device_lease"
    );
    const schemaCols = new Set((schemaRes || []).map((c) => c.Field));
    const allowedLeaseColumnsArr = [
      "member_id",
      "staff_member_id",
      "device_id",
      "company_id",
      "expected_return_date",
      "assigned_date",
      "returned",
      "location",
      "return_status",
      "condition_note",
      "returned_date",
    ];
    const allowedLeaseColumns = new Set(allowedLeaseColumnsArr);

    if (schemaCols.size === 0) {
      return response.status(500).json({
        ok: false,
        msg: "Schema lookup failed for member_assigned_device_lease.",
      });
    }

    // Normalize aliases and boolean values
    const normalizeWhere = (row) => {
      const r = { ...row };
      if (r.staff_member_id === undefined && r.staff_id !== undefined) {
        r.staff_member_id = r.staff_id;
      }
      if (r.company_id === undefined && r.companyId !== undefined) {
        r.company_id = r.companyId;
      }
      if (r.expected_return_date === undefined && r.return_date !== undefined) {
        r.expected_return_date = r.return_date;
      }
      if (r.assigned_date === undefined && r.assignment_date !== undefined) {
        r.assigned_date = r.assignment_date;
      }
      if (r.returned !== undefined) {
        const v = r.returned;
        r.returned =
          v === true ||
          v === 1 ||
          String(v).trim() === "1" ||
          String(v).toLowerCase().trim() === "true"
            ? 1
            : 0;
      }
      return r;
    };

    const normalizedWhere = normalizeWhere(srcWhere);

    // Build WHERE clause from allowed filters; support array (IN) and scalar (=)
    const filters = [];
    const values = [];
    for (const key of allowedLeaseColumnsArr) {
      if (
        normalizedWhere[key] !== undefined &&
        schemaCols.has(key) &&
        allowedLeaseColumns.has(key)
      ) {
        const val = normalizedWhere[key];
        if (Array.isArray(val)) {
          const cleaned = val
            .map((v) => (v !== undefined && v !== null ? String(v).trim() : ""))
            .filter((v) => v.length > 0);
          if (cleaned.length) {
            const ph = cleaned.map(() => "?").join(", ");
            filters.push("madl.`" + key + "` IN (" + ph + ")");
            values.push(...cleaned);
          }
        } else {
          filters.push("madl.`" + key + "` = ?");
          values.push(String(val).trim());
        }
      }
    }

    const whereClause = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";

    // Build SELECT list with explicit columns from lease and item_inv (prefixed)
    const [itemSchemaRes] = await connection.query(
      "SHOW COLUMNS FROM item_inv"
    );
    const itemCols = (itemSchemaRes || []).map((c) => c.Field);
    const leaseSelectParts = allowedLeaseColumnsArr
      .filter((c) => schemaCols.has(c))
      .map((c) => "madl.`" + c + "`");
    const itemSelectParts = itemCols.map(
      (c) => "ii.`" + c + "` AS `device_" + c + "`"
    );
    const selectList = leaseSelectParts.concat(itemSelectParts).join(", ");

    const query = `SELECT ${selectList} FROM member_assigned_device_lease AS madl LEFT JOIN item_inv AS ii ON ii.\`item_id\` = madl.\`device_id\`${whereClause}`;
    const [rows] = await connection.query(query, values);
    return response.status(200).json({
      ok: true,
      count: rows.length || 0,
      filters: filters.map((f) => f.split(" ")[0].replace(/`/g, "")),
      rows,
    });
  } catch (error) {
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

    const allowedColumns = [
        'first_name', 'last_name', 'email', 'phone_number',
        'address', 'address_street', 'address_city', 'address_state', 'address_zip',
        'company_id', 'image_url', 'minor', 'parent_guardian_first_name',
        'parent_guardian_last_name', 'parent_guardian_email', 'parent_guardian_phone_number',
        'grade', 'homeroom', 'external_id'
    ];

    const updateData = {};

    for (const key in body) {
        if (allowedColumns.includes(key)) {
            if (typeof body[key] === 'string') {
                updateData[key] = body[key].trim();
            } else {
                updateData[key] = body[key];
            }
        }
    }

    if (body.phone || body.phoneNumber) {
        updateData.phone_number = String(body.phone || body.phoneNumber).trim();
    }

    const columnsToUpdate = Object.keys(updateData);
    if (columnsToUpdate.length === 0) {
      return response
        .status(400)
        .json({ message: "No updatable fields provided." });
    }

    const setClause = columnsToUpdate.map((c) => `\`${c}\` = ?`).join(", ");
    const values = columnsToUpdate.map((k) => updateData[k]);
    const query = `UPDATE members_info SET ${setClause} WHERE member_id = ?`;
    values.push(String(member_id).trim());

    const [result] = await connection.query(query, values);
    return response.status(200).json({
      ok: true,
      updated_fields: columnsToUpdate,
      affectedRows: result.affectedRows || 0,
    });
  } catch (error) {
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
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

const insertNewRowINMemberAssignedDeviceTableForLeaseTracking = async (
  request,
  response
) => {
  // table name: member_assigned_device_lease
  // Controller supports single or bulk insert; filters against actual schema
  try {
    const body = request.body || {};

    // Accept single object or arrays in common keys
    const input = Array.isArray(body.rows)
      ? body.rows
      : Array.isArray(body.list)
      ? body.list
      : Array.isArray(body.data)
      ? body.data
      : Array.isArray(body.items)
      ? body.items
      : [body];

    // Fetch actual table columns to avoid unknown column errors
    const [schemaRes] = await connection.query(
      "SHOW COLUMNS FROM member_assigned_device_lease"
    );
    const schemaCols = new Set((schemaRes || []).map((c) => c.Field));
    if (schemaCols.size === 0) {
      return response.status(500).json({
        ok: false,
        msg: "Schema lookup failed for member_assigned_device_lease.",
      });
    }
    // Enforce exact allowed columns based on provided schema
    const allowedLeaseColumnsArr = [
      "member_id",
      "staff_member_id",
      "device_id",
      "company_id",
      "expected_return_date",
      "returned",
      "location",
      "assigned_date",
      "return_status",
      "condition_note",
      "returned_date",
    ];
    const allowedLeaseColumns = new Set(allowedLeaseColumnsArr);
    const schemaHas = (k) => schemaCols.has(k) && allowedLeaseColumns.has(k);

    const normalize = (r) => {
      const row = { ...r };
      // Normalize booleans and common aliases
      if (row.returned !== undefined) {
        const v = row.returned;
        row.returned =
          v === true ||
          v === 1 ||
          String(v).trim() === "1" ||
          String(v).toLowerCase().trim() === "true"
            ? 1
            : 0;
      }
      if (row.returned === undefined) {
        // A freshly created lease is outstanding, not returned.
        row.returned = 0;
      }

      // Normalize date aliases if provided
      if (
        row.expected_return_date === undefined &&
        row.return_date !== undefined
      ) {
        row.expected_return_date = row.return_date;
      }
      if (
        row.assigned_date === undefined &&
        row.assignment_date !== undefined
      ) {
        row.assigned_date = row.assignment_date;
      }

      // Common identity aliases
      if (row.staff_member_id === undefined && row.staff_id !== undefined) {
        row.staff_member_id = row.staff_id;
      }
      if (row.company_id === undefined && row.companyId !== undefined) {
        row.company_id = row.companyId;
      }

      // Coerce any recognizable date format (incl. locale strings like
      // "7/14/2026") into MySQL DATETIME, which rejects them raw.
      for (const key of ["expected_return_date", "assigned_date", "returned_date"]) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
          const d = new Date(row[key]);
          if (!isNaN(d.getTime())) {
            row[key] = d.toISOString().slice(0, 19).replace("T", " ");
          }
        }
      }

      return row;
    };

    const normalized = input.map(normalize);
    // Validate required not-null identifiers per row
    const requiredKeys = [
      "member_id",
      "staff_member_id",
      "device_id",
      "company_id",
    ];
    const invalidRows = normalized.filter((r) =>
      requiredKeys.some((k) => r[k] === undefined)
    );
    if (invalidRows.length > 0) {
      return response.status(400).json({
        ok: false,
        msg: `Missing required identifiers (member_id, staff_member_id, device_id, company_id) for ${invalidRows.length} row(s).`,
      });
    }

    // Representative accountability: a minor cannot receive a device without
    // a complete guardian on file — the guardian is the responsible party
    // who signs the liability contract.
    const memberIds = [...new Set(normalized.map((r) => Number(r.member_id)))];
    const [memberRows] = await connection.query(
      `SELECT member_id, first_name, last_name, minor,
              parent_guardian_first_name, parent_guardian_last_name,
              parent_guardian_email
       FROM members_info WHERE member_id IN (${memberIds.map(() => "?").join(",")})`,
      memberIds
    );
    const blockedMinors = (memberRows || []).filter(
      (m) =>
        Number(m.minor) === 1 &&
        (!m.parent_guardian_email ||
          !String(m.parent_guardian_email).trim() ||
          !m.parent_guardian_first_name ||
          !String(m.parent_guardian_first_name).trim())
    );
    if (blockedMinors.length > 0) {
      return response.status(422).json({
        ok: false,
        code: "GUARDIAN_REQUIRED",
        msg: `Cannot assign devices: ${blockedMinors
          .map((m) => `${m.first_name} ${m.last_name}`)
          .join(", ")} ${
          blockedMinors.length === 1 ? "is a minor" : "are minors"
        } without a complete parent/guardian (representative) on file. Add the representative's name and email first.`,
        members: blockedMinors.map((m) => m.member_id),
      });
    }

    // Determine column set to use: union of present keys intersected with schema
    const present = new Set();
    for (const r of normalized) {
      for (const k of Object.keys(r))
        if (r[k] !== undefined && allowedLeaseColumns.has(k)) present.add(k);
    }
    const columns = Array.from(present).filter((k) => schemaHas(k));

    // Require minimally identifying fields
    if (!columns.length) {
      return response.status(400).json({
        ok: false,
        msg: "No valid insertable fields for member_assigned_device_lease.",
      });
    }

    // Build multi-values insert
    const rowPlaceholders = `(${columns.map(() => "?").join(", ")})`;
    const placeholders = normalized.map(() => rowPlaceholders).join(", ");
    const values = [];
    for (const r of normalized) {
      for (const c of columns) values.push(r[c] !== undefined ? r[c] : null);
    }

    const query = `INSERT INTO member_assigned_device_lease (${columns.join(
      ", "
    )}) VALUES ${placeholders}`;

    const [result] = await connection.query(query, values);
    return response.status(201).json({
      ok: true,
      requested: normalized.length,
      affectedRows: result.affectedRows || 0,
      insertId: result.insertId || null,
      columns,
    });
  } catch (error) {
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

// Update rows in member_assigned_device_lease using dynamic filters and updates
const updateMemberAssignedDeviceLeaseRow = async (request, response) => {
  try {
    const body = request.body || {};
    // Lookup schema to validate columns
    const [schemaRes] = await connection.query(
      "SHOW COLUMNS FROM member_assigned_device_lease"
    );
    const schemaCols = new Set((schemaRes || []).map((c) => c.Field));
    if (schemaCols.size === 0) {
      return response.status(500).json({
        ok: false,
        msg: "Schema lookup failed for member_assigned_device_lease.",
      });
    }
    // Allowed columns per provided schema
    const allowedLeaseColumnsArr = [
      "member_id",
      "staff_member_id",
      "device_id",
      "company_id",
      "expected_return_date",
      "returned",
      "location",
      "assigned_date",
      "return_status",
      "condition_note",
      "returned_date",
    ];
    const allowedLeaseColumns = new Set(allowedLeaseColumnsArr);

    // Normalization helpers
    const normalizeRow = (row) => {
      const r = { ...row };
      if (r.returned !== undefined) {
        const v = r.returned;
        r.returned =
          v === true ||
          v === 1 ||
          String(v).trim() === "1" ||
          String(v).toLowerCase().trim() === "true"
            ? 1
            : 0;
      }
      if (r.expected_return_date === undefined && r.return_date !== undefined) {
        r.expected_return_date = r.return_date;
      }
      if (r.assigned_date === undefined && r.assignment_date !== undefined) {
        r.assigned_date = r.assignment_date;
      }
      if (r.staff_member_id === undefined && r.staff_id !== undefined) {
        r.staff_member_id = r.staff_id;
      }
      if (r.company_id === undefined && r.companyId !== undefined) {
        r.company_id = r.companyId;
      }
      return r;
    };

    const srcWhere =
      typeof body.where === "object" && body.where ? body.where : body;
    const normalizedWhere = normalizeRow(srcWhere);

    // Build filter keys: intersect normalizedWhere with schema
    const candidateFilters = [
      "member_id",
      "staff_member_id",
      "device_id",
      "company_id",
      "expected_return_date",
      "assigned_date",
      "returned",
      "location",
    ];
    const filters = candidateFilters
      .filter(
        (k) =>
          normalizedWhere[k] !== undefined &&
          schemaCols.has(k) &&
          allowedLeaseColumns.has(k)
      )
      .map((k) => [k, String(normalizedWhere[k]).trim()]);

    if (!filters.length) {
      return response.status(400).json({
        ok: false,
        msg: "Provide at least one valid filter (member_id/device_id/company_id/staff_member_id/etc.).",
      });
    }

    // Build update set: from body.update or body itself, minus filters
    const srcUpdate =
      typeof body.update === "object" && body.update
        ? body.update
        : body.update === undefined
        ? body
        : {};
    const normalizedUpdate = normalizeRow(srcUpdate);

    // Exclude filter keys from update set
    const updateEntries = Object.entries(normalizedUpdate).filter(
      ([k, v]) =>
        v !== undefined &&
        schemaCols.has(k) &&
        allowedLeaseColumns.has(k) &&
        !filters.some(([fk]) => fk === k)
    );

    if (!updateEntries.length) {
      return response.status(400).json({
        ok: false,
        msg: "Provide at least one valid column to update.",
      });
    }

    const setClause = updateEntries.map(([k]) => `\`${k}\` = ?`).join(", ");
    const whereClause = filters.map(([k]) => `\`${k}\` = ?`).join(" AND ");
    const values = updateEntries
      .map(([, v]) => v)
      .concat(filters.map(([, v]) => v));

    const query = `UPDATE member_assigned_device_lease SET ${setClause} WHERE ${whereClause}`;
    const [result] = await connection.query(query, values);
    return response.status(200).json({
      ok: true,
      updated_fields: updateEntries.map(([k]) => k),
      filters: filters.map(([k]) => k),
      affectedRows: result.affectedRows || 0,
    });
  } catch (error) {
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

// Delete rows from member_assigned_device_lease by id list or filters
const deleteMemberAssignedDeviceLeaseRows = async (request, response) => {
  try {
    const body = request.body || {};
    const [schemaRes] = await connection.query(
      "SHOW COLUMNS FROM member_assigned_device_lease"
    );
    const schemaCols = new Set((schemaRes || []).map((c) => c.Field));
    if (schemaCols.size === 0) {
      return response.status(500).json({
        ok: false,
        msg: "Schema lookup failed for member_assigned_device_lease.",
      });
    }
    // Allowed columns per provided schema for filters
    const allowedLeaseColumnsArr = [
      "member_id",
      "staff_member_id",
      "device_id",
      "company_id",
      "expected_return_date",
      "returned",
      "location",
      "assigned_date",
      "return_status",
      "condition_note",
      "returned_date",
    ];
    const allowedLeaseColumns = new Set(allowedLeaseColumnsArr);

    // Mode 2: delete by filters
    const srcWhere =
      typeof body.where === "object" && body.where ? body.where : body;

    // Normalize common aliases
    const normalizeWhere = (row) => {
      const r = { ...row };
      if (r.staff_member_id === undefined && r.staff_id !== undefined) {
        r.staff_member_id = r.staff_id;
      }
      if (r.company_id === undefined && r.companyId !== undefined) {
        r.company_id = r.companyId;
      }
      if (r.returned !== undefined) {
        const v = r.returned;
        r.returned =
          v === true ||
          v === 1 ||
          String(v).trim() === "1" ||
          String(v).toLowerCase().trim() === "true"
            ? 1
            : 0;
      }
      return r;
    };

    const normalizedWhere = normalizeWhere(srcWhere);
    const candidateFilters = [
      "member_id",
      "staff_member_id",
      "device_id",
      "company_id",
      "expected_return_date",
      "assigned_date",
      "returned",
      "location",
    ];
    const filters = candidateFilters
      .filter(
        (k) =>
          normalizedWhere[k] !== undefined &&
          schemaCols.has(k) &&
          allowedLeaseColumns.has(k)
      )
      .map((k) => [k, String(normalizedWhere[k]).trim()]);

    if (!filters.length) {
      return response.status(400).json({
        ok: false,
        msg: "Provide at least one valid filter to delete (member_id/device_id/company_id/staff_member_id/etc.).",
      });
    }

    const whereClause = filters.map(([k]) => `\`${k}\` = ?`).join(" AND ");
    const values = filters.map(([, v]) => v);
    const query = `DELETE FROM member_assigned_device_lease WHERE ${whereClause}`;
    const [result] = await connection.query(query, values);
    return response.status(200).json({
      ok: true,
      filters: filters.map(([k]) => k),
      affectedRows: result.affectedRows || 0,
    });
  } catch (error) {
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

const removeRowAssignedDeviceLeaseMember = async (request, response) => {
  try {
    const body = request.body || {};

    const memberId = body.member_id ?? body.memberId;
    const companyId = body.company_id ?? body.companyId;
    const deviceId = body.device_id ?? body.deviceId;

    if (
      [memberId, companyId, deviceId].some(
        (v) => v === undefined || v === null || String(v).trim().length === 0
      )
    ) {
      return response.status(400).json({
        ok: false,
        msg: "device_id, company_id, and member_id are required.",
      });
    }

    const [schemaRes] = await connection.query(
      "SHOW COLUMNS FROM member_assigned_device_lease"
    );
    const schemaCols = new Set((schemaRes || []).map((c) => c.Field));
    const requiredCols = ["member_id", "company_id", "device_id"];
    for (const col of requiredCols) {
      if (!schemaCols.has(col)) {
        return response.status(500).json({
          ok: false,
          msg: `Column ${col} not found in member_assigned_device_lease`,
        });
      }
    }

    const values = [
      String(deviceId).trim(),
      String(companyId).trim(),
      String(memberId).trim(),
    ];
    const query =
      "DELETE madl FROM member_assigned_device_lease AS madl WHERE madl.`device_id` = ? AND madl.`company_id` = ? AND madl.`member_id` = ?";
    const [res] = await connection.query(query, values);
    return response.status(200).json({
      ok: true,
      deleted_count: res.affectedRows || 0,
      criteria: {
        device_id: values[0],
        company_id: values[1],
        member_id: values[2],
      },
    });
  } catch (error) {
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

// Outstanding leases past their expected return date, joined with the member
// (incl. guardian contact for reminder emails) and device details.
const retrieveOverdueLeases = async (request, response) => {
  try {
    const { company_id, grade } = request.body || {};
    if (!company_id) {
      return response
        .status(400)
        .json({ ok: false, msg: "company_id is required" });
    }
    const values = [String(company_id)];
    let gradeClause = "";
    if (grade !== undefined && grade !== null && String(grade).trim() !== "") {
      gradeClause = " AND mi.grade = ?";
      values.push(String(grade).trim());
    }
    const query = `
      SELECT
        madl.lease_id, madl.member_id, madl.device_id, madl.company_id,
        madl.assigned_date, madl.expected_return_date, madl.location,
        DATEDIFF(NOW(), madl.expected_return_date) AS days_overdue,
        mi.first_name, mi.last_name, mi.email, mi.grade, mi.homeroom,
        mi.minor, mi.parent_guardian_first_name, mi.parent_guardian_email,
        ii.serial_number AS device_serial_number, ii.item_group AS device_item_group,
        ii.category_name AS device_category_name, ii.brand AS device_brand
      FROM member_assigned_device_lease madl
      JOIN members_info mi ON mi.member_id = madl.member_id
      LEFT JOIN item_inv ii ON ii.item_id = madl.device_id
      WHERE madl.company_id = ? AND madl.returned = 0
        AND madl.expected_return_date IS NOT NULL
        AND madl.expected_return_date < NOW()${gradeClause}
      ORDER BY madl.expected_return_date ASC`;
    const [rows] = await connection.query(query, values);
    return response.status(200).json({ ok: true, count: rows.length, rows });
  } catch (error) {
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

// Bulk return of outstanding leases — end-of-term collection. Scope by
// member_ids, grade, or everything outstanding for the company. Marks the
// lease rows returned (history preserved) and puts the devices back in the
// warehouse (skipped for status 'lost' — those devices never came back).
const bulkReturnMemberLeases = async (request, response) => {
  try {
    const {
      company_id,
      member_ids,
      grade,
      return_status = "returned",
      condition_note = null,
    } = request.body || {};
    if (!company_id) {
      return response
        .status(400)
        .json({ ok: false, msg: "company_id is required" });
    }
    if (!["returned", "lost", "damaged"].includes(return_status)) {
      return response
        .status(400)
        .json({ ok: false, msg: "return_status must be returned|lost|damaged" });
    }

    // Resolve the outstanding leases in scope first so we can sync inventory.
    const scopeValues = [String(company_id)];
    let scopeClause = "";
    if (Array.isArray(member_ids) && member_ids.length) {
      scopeClause = ` AND madl.member_id IN (${member_ids.map(() => "?").join(",")})`;
      scopeValues.push(...member_ids.map((m) => Number(m)));
    } else if (grade !== undefined && grade !== null && String(grade).trim() !== "") {
      scopeClause = " AND mi.grade = ?";
      scopeValues.push(String(grade).trim());
    }
    const [leases] = await connection.query(
      `SELECT madl.lease_id, madl.device_id
       FROM member_assigned_device_lease madl
       JOIN members_info mi ON mi.member_id = madl.member_id
       WHERE madl.company_id = ? AND madl.returned = 0${scopeClause}`,
      scopeValues
    );
    if (!leases.length) {
      return response
        .status(200)
        .json({ ok: true, returned: 0, msg: "No outstanding leases in scope." });
    }

    const leaseIds = leases.map((l) => l.lease_id);
    await connection.query(
      `UPDATE member_assigned_device_lease
       SET returned = 1, return_status = ?, condition_note = ?, returned_date = NOW()
       WHERE lease_id IN (${leaseIds.map(() => "?").join(",")})`,
      [return_status, condition_note, ...leaseIds]
    );

    // Physical devices come back for 'returned'/'damaged'; 'lost' stays out.
    let devicesRestocked = 0;
    if (return_status !== "lost") {
      const deviceIds = [...new Set(leases.map((l) => l.device_id).filter(Boolean))];
      if (deviceIds.length) {
        const [res] = await connection.query(
          `UPDATE item_inv SET warehouse = 1, logistic_status = 'in-stock', \`update_at\` = NOW()
           WHERE company_id = ? AND item_id IN (${deviceIds.map(() => "?").join(",")})`,
          [String(company_id), ...deviceIds]
        );
        devicesRestocked = res.affectedRows || 0;
      }
    }

    return response.status(200).json({
      ok: true,
      returned: leaseIds.length,
      devicesRestocked,
      return_status,
    });
  } catch (error) {
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
  insertNewRowINMemberAssignedDeviceTableForLeaseTracking,
  updateMemberAssignedDeviceLeaseRow,
  deleteMemberAssignedDeviceLeaseRows,
  retrieveMembersAssignedDevices,
  removeRowAssignedDeviceLeaseMember,
  retrieveOverdueLeases,
  bulkReturnMemberLeases,
};
