require("dotenv").config();
// const logger = require("../../helpers/logger");
const getConnection = require("../database/config");
const { minorsMissingConsent, isConsentStale } = require("../helpers/consentGate");
const { isUnder13 } = require("../helpers/ageCalc");
const { memberContactProblem, filled } = require("../helpers/memberContact");
const { chunkArray } = require("../../helpers/chunkArray");
const { enqueue, extractJobContext } = require("../../helpers/queue");
const { waitForJobOutcome } = require("../../helpers/queuedController");
const connection = getConnection();

// Rows per INSERT statement for bulk writes. Keeps a single statement's
// placeholder count and payload size well under MySQL/PlanetScale limits
// even for large imports (thousands of rows), instead of building one
// unbounded VALUES list for the whole request.
const BULK_INSERT_BATCH_SIZE = 500;

const normalizeDateOfBirth = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const parsed = new Date(`${value.trim()}T00:00:00Z`);
    return isNaN(parsed.getTime()) ? null : value.trim();
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

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
      date_of_birth: normalizeDateOfBirth(body.date_of_birth ?? body.dateOfBirth ?? body.dob),
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

    const contactProblem = memberContactProblem(allowed);
    if (contactProblem) {
      return response.status(400).json({
        ok: false,
        message: contactProblem.msg,
        missing: contactProblem.missing,
      });
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

// Migrado a cola (ver project_bulk_queue_migration_plan.md): un import CSV
// a nivel de distrito escolar puede ser miles de filas. El controller
// normaliza las filas y resuelve las columnas reales de la tabla (rápido,
// sin escritura); el INSERT real vive en
// queue/handlers/bulkInsertMembers.js. Usa waitForJobOutcome para
// responder con la misma forma de siempre en el caso típico.
function createInsertBulkMembers({
  enqueueFn = enqueue,
  extractContextFn = extractJobContext,
  waitForJobOutcomeFn = waitForJobOutcome,
  maxWaitMs = 4000,
} = {}) {
  return async function insertBulkMembers(request, response) {
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

      const email = filled(r.email) ? String(r.email).trim() : undefined;
      const phone_number_raw = r.phone_number ?? r.phone ?? r.phoneNumber;
      const phone_number = filled(phone_number_raw)
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

      const date_of_birth = normalizeDateOfBirth(r.date_of_birth ?? r.dateOfBirth ?? r.dob);

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
        grade: r.grade !== undefined && r.grade !== null ? String(r.grade).trim() : undefined,
        homeroom: r.homeroom !== undefined && r.homeroom !== null ? String(r.homeroom).trim() : undefined,
        date_of_birth,
        minor: r.minor,
        parent_guardian_first_name:
          r.parent_guardian_first_name !== undefined && r.parent_guardian_first_name !== null
            ? String(r.parent_guardian_first_name).trim()
            : undefined,
        parent_guardian_last_name:
          r.parent_guardian_last_name !== undefined && r.parent_guardian_last_name !== null
            ? String(r.parent_guardian_last_name).trim()
            : undefined,
        parent_guardian_email:
          r.parent_guardian_email !== undefined && r.parent_guardian_email !== null
            ? String(r.parent_guardian_email).trim()
            : undefined,
        parent_guardian_phone_number:
          r.parent_guardian_phone_number !== undefined && r.parent_guardian_phone_number !== null
            ? String(r.parent_guardian_phone_number).trim()
            : undefined,
      };
    };

    const normalized = input.map(normalize);
    const named = normalized.filter((r) => r.first_name && r.last_name);
    if (!named.length) {
      return response.status(400).json({
        ok: false,
        msg: "No valid rows with first_name and last_name.",
        skipped: normalized.length,
      });
    }

    // Misma regla que el alta individual: la fila que no la cumple se salta
    // (como las que no traen nombre) y el resto entra. `row` es el índice en
    // el array que mandó el cliente.
    const contact_skipped = [];
    const valid = [];
    normalized.forEach((r, row) => {
      if (!(r.first_name && r.last_name)) return;
      const problem = memberContactProblem(r);
      if (problem) contact_skipped.push({ row, missing: problem.missing, msg: problem.msg });
      else valid.push(r);
    });
    const skipped = normalized.length - valid.length;

    if (!valid.length) {
      return response.status(400).json({
        ok: false,
        msg: "No rows meet the member contact requirements.",
        skipped,
        contact_skipped,
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
      "date_of_birth",
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

    const payload = { valid, columns };
    const job = await enqueueFn("member:bulk-insert", payload, {
      context: extractContextFn(request),
    });

    const outcome = await waitForJobOutcomeFn(job, { maxWaitMs });
    if (outcome.outcome === "done") {
      return response.status(201).json({
        ok: true,
        requested: input.length,
        inserted: valid.length,
        skipped,
        contact_skipped,
        columns,
        ...outcome.result,
      });
    }
    if (outcome.outcome === "failed") {
      return response.status(500).json({
        ok: false,
        msg: outcome.job.lastError || "Bulk insert failed",
      });
    }
    return response.status(202).json({
      ok: true,
      jobId: job.id,
      msg: "Request queued — still processing. Poll GET /api/jobs/owned/:jobId for the result.",
    });
  } catch (error) {
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
  };
}
const insertBulkMembers = createInsertBulkMembers();

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
        'grade', 'homeroom', 'external_id', 'date_of_birth'
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
    if (body.dateOfBirth !== undefined || body.dob !== undefined) {
        updateData.date_of_birth = normalizeDateOfBirth(body.dateOfBirth ?? body.dob);
    } else if (body.date_of_birth !== undefined) {
        updateData.date_of_birth = normalizeDateOfBirth(body.date_of_birth);
    }

    const columnsToUpdate = Object.keys(updateData);
    if (columnsToUpdate.length === 0) {
      return response
        .status(400)
        .json({ message: "No updatable fields provided." });
    }

    // La regla se mira sobre cómo QUEDA la fila: vaciar el email de un adulto o
    // pasar un menor sin contacto a adulto también tiene que fallar.
    const CONTACT_FIELDS = ["email", "phone_number", "minor", "parent_guardian_email"];
    if (columnsToUpdate.some((c) => CONTACT_FIELDS.includes(c))) {
      const [rows] = await connection.query(
        `SELECT ${CONTACT_FIELDS.join(", ")} FROM members_info WHERE member_id = ?`,
        [String(member_id).trim()]
      );
      if (rows && rows[0]) {
        const contactProblem = memberContactProblem({ ...rows[0], ...updateData });
        if (contactProblem) {
          return response.status(400).json({
            ok: false,
            message: contactProblem.msg,
            missing: contactProblem.missing,
          });
        }
      }
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
      `SELECT member_id, first_name, last_name, minor, date_of_birth,
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

    // Consent enforcement — OPT-IN per company via company_school_settings. A
    // MISSING row or any read failure => OFF (fallback), so this NEVER breaks
    // assignment for companies that haven't enabled it. When ON, a minor also
    // needs a RECORDED consent (school_consent), not just a guardian on file.
    const companyIds = [...new Set(normalized.map((r) => Number(r.company_id)))];
    let enforceConsent = false;
    try {
      const cph = companyIds.map(() => "?").join(",");
      const [cfg] = await connection.query(
        `SELECT company_id FROM company_school_settings
          WHERE enforce_member_consent = 1 AND company_id IN (${cph})`,
        companyIds
      );
      enforceConsent = (cfg || []).length > 0;
    } catch (_) {
      enforceConsent = false; // fallback: never block on a settings read failure
    }
    if (enforceConsent) {
      const minorIds = (memberRows || [])
        .filter((m) => Number(m.minor) === 1)
        .map((m) => m.member_id);
      let consentedSet = new Set();
      if (minorIds.length > 0) {
        const mph = minorIds.map(() => "?").join(",");
        const [consented] = await connection.query(
          `SELECT DISTINCT member_id FROM school_consent WHERE member_id IN (${mph}) AND status = 'agreed'`,
          minorIds
        );
        consentedSet = new Set((consented || []).map((c) => c.member_id));
      }
      const missing = minorsMissingConsent(memberRows || [], consentedSet);
      if (missing.length > 0) {
        return response.status(422).json({
          ok: false,
          code: "CONSENT_REQUIRED",
          msg: `Cannot assign devices: ${missing
            .map((m) => `${m.first_name} ${m.last_name}`)
            .join(", ")} ${
            missing.length === 1 ? "is a minor" : "are minors"
          } without a recorded guardian consent (AUP). Record consent first (POST /api/school/consent/record).`,
          members: missing.map((m) => m.member_id),
        });
      }
    }

    // Under-13 COPPA enforcement — opt-in per company via
    // company_school_settings.enforce_under_13_consent. This only blocks device
    // assignment; student creation/import remains allowed so schools can build
    // rosters before consent collection.
    try {
      const cph2 = companyIds.map(() => "?").join(",");
      const [coppaSettings] = await connection.query(
        `SELECT company_id, enforce_under_13_consent, required_consent_policy_version
           FROM company_school_settings
          WHERE enforce_under_13_consent = 1 AND company_id IN (${cph2})`,
        companyIds
      );

      if ((coppaSettings || []).length > 0) {
        const enforcingCompanies = new Set(coppaSettings.map((r) => Number(r.company_id)));
        const versionByCompany = new Map();
        for (const r of coppaSettings) {
          if (r.required_consent_policy_version) {
            versionByCompany.set(Number(r.company_id), r.required_consent_policy_version);
          }
        }

        const consentedByMemberCompany = new Map();
        const memberCompanyPairs = normalized
          .filter((r) => enforcingCompanies.has(Number(r.company_id)))
          .map((r) => [Number(r.member_id), Number(r.company_id)]);
        if (memberCompanyPairs.length > 0) {
          const mph2 = [...new Set(memberCompanyPairs.map(([mid]) => mid))].map(() => "?").join(",");
          const [consentRows] = await connection.query(
            `SELECT member_id, company_id, policy_version
               FROM school_consent
              WHERE member_id IN (${mph2}) AND status = 'agreed'`,
            [...new Set(memberCompanyPairs.map(([mid]) => mid))]
          );
          for (const c of consentRows || []) {
            const key = `${Number(c.member_id)}:${Number(c.company_id)}`;
            if (!consentedByMemberCompany.has(key)) {
              consentedByMemberCompany.set(key, []);
            }
            consentedByMemberCompany.get(key).push(c.policy_version);
          }
        }

        const memberById = new Map((memberRows || []).map((m) => [Number(m.member_id), m]));
        const under13Blocked = [];
        for (const r of normalized) {
          const cid = Number(r.company_id);
          const mid = Number(r.member_id);
          if (!enforcingCompanies.has(cid)) continue;

          const member = memberById.get(mid);
          if (isUnder13(member?.date_of_birth, new Date()) !== true) continue;

          const key = `${mid}:${cid}`;
          const versions = consentedByMemberCompany.get(key) || [];
          if (versions.length === 0) {
            under13Blocked.push(mid);
            continue;
          }

          const requiredVersion = versionByCompany.get(cid);
          if (requiredVersion && versions.every((version) => isConsentStale(version, requiredVersion))) {
            under13Blocked.push(mid);
          }
        }

        if (under13Blocked.length > 0) {
          const blockedNames = (memberRows || [])
            .filter((m) => under13Blocked.includes(Number(m.member_id)))
            .map((m) => `${m.first_name} ${m.last_name}`);
          return response.status(422).json({
            ok: false,
            code: "UNDER_13_CONSENT_REQUIRED",
            msg: `Cannot assign devices: ${blockedNames.join(", ")} ${
              blockedNames.length === 1 ? "is" : "are"
            } under 13 and require guardian consent (COPPA). Record consent first (POST /api/school/consent/record).`,
            members: under13Blocked,
          });
        }
      }
    } catch (_) {
      // fallback: never block on settings/consent read failure
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
// ---------------------------------------------------------------------------
// Member fees for lost / damaged devices (school track).
//
// The fee lives in `member_fees`, not on the lease row — see
// mysql/migrations/add_member_fees.sql for why. It is written from two places:
//   B1.1  update-member-assigned-device-lease, which carries fee_amount /
//         fee_reason inside `update` (the frontend has always posted them there)
//   B1.3  settle-member-fee, once the card has actually been charged
// ---------------------------------------------------------------------------

const FEE_PAYMENT_METHODS = new Set(["credit_card", "cash", "waived"]);
// A fee is only meaningful on a device that did not come back intact. A fee on a
// clean return is a caller bug the frontend would rather see rejected.
const FEE_BEARING_RETURN_STATUSES = new Set(["lost", "damaged"]);

// Amounts cross this boundary in DOLLARS as a JSON number (250 or 75.5), never
// in cents — storing cents here would silently 100x every fee. `undefined` means
// "not mentioned" (leave any existing fee alone); explicit null/"" means "clear".
const normalizeFeeAmount = (value) => {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || String(value).trim() === "")
    return { ok: true, value: null };
  if (typeof value !== "number" && typeof value !== "string") {
    return { ok: false, msg: "fee_amount must be a number of dollars." };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, msg: "fee_amount must be a number of dollars." };
  }
  if (parsed <= 0) {
    // 0 and "no fee" must not be distinguishable on paper.
    return { ok: false, msg: "fee_amount must be greater than 0." };
  }
  if (parsed > 99999999.99) {
    return { ok: false, msg: "fee_amount exceeds the maximum allowed value." };
  }
  return { ok: true, value: Math.round(parsed * 100) / 100 };
};

// MySQL DATETIME, in UTC, so a settled-at timestamp cannot be read differently
// depending on where the server happens to run.
const toMysqlDatetime = (value) => {
  const date = value ? new Date(value) : new Date();
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
};

// The fee routes must stay deployable BEFORE the migration runs: without the
// table the fee is skipped exactly as it is dropped today, instead of turning a
// working lease update into a 500. Only the positive answer is cached, so the
// first call after the migration picks the table up without a restart.
let memberFeesTableReady = false;
const memberFeesTableExists = async () => {
  if (memberFeesTableReady) return true;
  try {
    const [rows] = await connection.query("SHOW TABLES LIKE 'member_fees'");
    memberFeesTableReady = Array.isArray(rows) && rows.length > 0;
    return memberFeesTableReady;
  } catch (error) {
    return false;
  }
};

// Pulls the fee out of an `update` payload. Absence is never "clear the fee":
// the same route is used to edit only expected_return_date, and that call must
// not wipe a recorded fee.
const extractFeePayload = (update = {}) => {
  const hasAmount = update.fee_amount !== undefined;
  const hasReason = update.fee_reason !== undefined;
  if (!hasAmount && !hasReason) return { present: false };
  return {
    present: true,
    hasAmount,
    fee_amount: update.fee_amount,
    fee_reason: hasReason
      ? update.fee_reason === null
        ? null
        : String(update.fee_reason).trim() || null
      : undefined,
  };
};

// One OUTSTANDING fee per (company, member, device): a re-submitted declaration
// corrects the open fee instead of stacking a second debt, while a device that
// already has a settled fee can legitimately accrue a new one.
const upsertOutstandingFee = async ({
  company_id,
  member_id,
  device_id,
  fee_amount,
  fee_reason,
  return_status,
}) => {
  const [existing] = await connection.query(
    `SELECT fee_id FROM member_fees
      WHERE company_id = ? AND member_id = ? AND device_id <=> ? AND status = 'outstanding'
      ORDER BY fee_id DESC LIMIT 1`,
    [company_id, member_id, device_id]
  );
  const current = existing?.[0];
  if (current) {
    const sets = [];
    const values = [];
    if (fee_amount !== undefined) {
      sets.push("fee_amount = ?");
      values.push(fee_amount);
    }
    if (fee_reason !== undefined) {
      sets.push("fee_reason = ?");
      values.push(fee_reason);
    }
    if (return_status !== undefined && return_status !== null) {
      sets.push("return_status = ?");
      values.push(return_status);
    }
    if (!sets.length) return { fee_id: current.fee_id, created: false };
    values.push(current.fee_id);
    await connection.query(
      `UPDATE member_fees SET ${sets.join(", ")} WHERE fee_id = ?`,
      values
    );
    return { fee_id: current.fee_id, created: false };
  }

  // Nothing open yet — a reason on its own has no debt to attach itself to.
  if (fee_amount === undefined || fee_amount === null) return null;

  const [result] = await connection.query(
    `INSERT INTO member_fees
       (company_id, member_id, device_id, fee_amount, fee_reason, return_status, status)
     VALUES (?, ?, ?, ?, ?, ?, 'outstanding')`,
    [
      company_id,
      member_id,
      device_id,
      fee_amount,
      fee_reason === undefined ? null : fee_reason,
      return_status ?? null,
    ]
  );
  return { fee_id: result.insertId, created: true };
};

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

    // The fee is not a lease column — it is routed to member_fees. Validated
    // here, BEFORE any write, so a malformed fee rejects the whole request
    // instead of closing the lease and losing the debt.
    const fee = extractFeePayload(normalizedUpdate);
    let feeAmount;
    let feeReturnStatus;
    if (fee.present) {
      const amount = normalizeFeeAmount(fee.fee_amount);
      if (!amount.ok) {
        return response.status(400).json({ ok: false, msg: amount.msg });
      }
      feeAmount = amount.value;

      if (
        normalizedWhere.company_id === undefined ||
        normalizedWhere.member_id === undefined ||
        normalizedWhere.device_id === undefined
      ) {
        return response.status(400).json({
          ok: false,
          msg: "A fee requires company_id, member_id and device_id in `where`.",
        });
      }

      // Which outcome the fee is attached to: this update when it declares one,
      // otherwise whatever the lease row already says.
      if (normalizedUpdate.return_status !== undefined) {
        feeReturnStatus = String(normalizedUpdate.return_status || "")
          .trim()
          .toLowerCase();
      } else {
        const [current] = await connection.query(
          `SELECT return_status FROM member_assigned_device_lease
            WHERE company_id = ? AND member_id = ? AND device_id = ? LIMIT 1`,
          [
            String(normalizedWhere.company_id).trim(),
            String(normalizedWhere.member_id).trim(),
            String(normalizedWhere.device_id).trim(),
          ]
        );
        feeReturnStatus = String(current?.[0]?.return_status || "")
          .trim()
          .toLowerCase();
      }
      if (!FEE_BEARING_RETURN_STATUSES.has(feeReturnStatus)) {
        return response.status(400).json({
          ok: false,
          msg: "A fee can only be recorded when return_status is 'lost' or 'damaged'.",
        });
      }
    }

    // A fee on its own is a valid request (staff adding a fee to a lease that
    // was already closed); without one, an empty update still is not.
    if (!updateEntries.length && !fee.present) {
      return response.status(400).json({
        ok: false,
        msg: "Provide at least one valid column to update.",
      });
    }

    let affectedRows = 0;
    if (updateEntries.length) {
      const setClause = updateEntries.map(([k]) => `\`${k}\` = ?`).join(", ");
      const whereClause = filters.map(([k]) => `\`${k}\` = ?`).join(" AND ");
      const values = updateEntries
        .map(([, v]) => v)
        .concat(filters.map(([, v]) => v));

      const query = `UPDATE member_assigned_device_lease SET ${setClause} WHERE ${whereClause}`;
      const [result] = await connection.query(query, values);
      affectedRows = result.affectedRows || 0;
    }

    let feeResult = null;
    let feeSkipped;
    if (fee.present) {
      if (await memberFeesTableExists()) {
        feeResult = await upsertOutstandingFee({
          company_id: Number(normalizedWhere.company_id),
          member_id: Number(normalizedWhere.member_id),
          device_id: Number(normalizedWhere.device_id),
          fee_amount: fee.hasAmount ? feeAmount : undefined,
          fee_reason: fee.fee_reason,
          return_status: feeReturnStatus,
        });
      } else {
        feeSkipped = "member_fees table not found — run mysql/migrations/add_member_fees.sql";
      }
    }

    return response.status(200).json({
      ok: true,
      updated_fields: updateEntries.map(([k]) => k),
      filters: filters.map(([k]) => k),
      affectedRows,
      fee: feeResult,
      ...(feeSkipped ? { fee_skipped: feeSkipped } : {}),
    });
  } catch (error) {
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

// Settle a member fee once the money has actually moved (B1.3).
//
// This is the other half of recording a fee: without it a family pays by card
// and the student's record still shows the debt as outstanding — the worst of
// the three possible states.
//
// Keyed by (member_id, device_id) as well as fee_id, because the charge modal
// can be opened standalone from the header with no lease row in hand. A fee that
// was never recorded is created here rather than 404'd — staff can charge for a
// device closed before fees existed.
const settleMemberFee = async (request, response) => {
  try {
    const body = request.body || {};
    const company_id = body.company_id ?? body.companyId;
    if (!company_id) {
      return response
        .status(400)
        .json({ ok: false, msg: "company_id is required" });
    }

    const fee_id = body.fee_id ?? null;
    const member_id = body.member_id ?? null;
    const device_id = body.device_id ?? null;
    if (!fee_id && !(member_id && device_id)) {
      return response.status(400).json({
        ok: false,
        msg: "Provide fee_id, or member_id together with device_id.",
      });
    }

    const status = String(body.status || "paid")
      .trim()
      .toLowerCase();
    if (!["paid", "waived"].includes(status)) {
      return response
        .status(400)
        .json({ ok: false, msg: "status must be 'paid' or 'waived'." });
    }

    const payment_method = String(
      body.payment_method || (status === "waived" ? "waived" : "credit_card")
    )
      .trim()
      .toLowerCase();
    if (!FEE_PAYMENT_METHODS.has(payment_method)) {
      return response.status(400).json({
        ok: false,
        msg: "payment_method must be 'credit_card', 'cash' or 'waived'.",
      });
    }

    const payment_intent = body.payment_intent
      ? String(body.payment_intent).trim()
      : null;
    if (status === "paid" && payment_method === "credit_card" && !payment_intent) {
      return response.status(400).json({
        ok: false,
        msg: "payment_intent is required for a credit_card payment.",
      });
    }

    const paid = normalizeFeeAmount(body.paid_amount);
    if (!paid.ok) {
      return response
        .status(400)
        .json({ ok: false, msg: paid.msg.replace("fee_amount", "paid_amount") });
    }
    if (status === "paid" && (paid.value === undefined || paid.value === null)) {
      return response.status(400).json({
        ok: false,
        msg: "paid_amount is required when status is 'paid'.",
      });
    }
    const paidAmount = paid.value === undefined ? null : paid.value;

    if (!(await memberFeesTableExists())) {
      return response.status(503).json({
        ok: false,
        msg: "member_fees is not available — run mysql/migrations/add_member_fees.sql.",
      });
    }

    // Idempotency: Stripe guarantees the intent id is unique, so a retry after a
    // network timeout resolves to the fee already settled instead of a second one.
    if (payment_intent) {
      const [seen] = await connection.query(
        "SELECT fee_id FROM member_fees WHERE payment_intent = ? LIMIT 1",
        [payment_intent]
      );
      if (seen?.length) {
        return response
          .status(200)
          .json({ ok: true, fee_id: seen[0].fee_id, idempotent: true });
      }
    }

    let target = null;
    if (fee_id) {
      const [rows] = await connection.query(
        "SELECT fee_id FROM member_fees WHERE fee_id = ? AND company_id = ? LIMIT 1",
        [Number(fee_id), Number(company_id)]
      );
      target = rows?.[0] || null;
      if (!target) {
        return response
          .status(404)
          .json({ ok: false, msg: "Fee not found for this company." });
      }
    } else {
      const [rows] = await connection.query(
        `SELECT fee_id FROM member_fees
          WHERE company_id = ? AND member_id = ? AND device_id = ? AND status = 'outstanding'
          ORDER BY fee_id DESC LIMIT 1`,
        [Number(company_id), Number(member_id), Number(device_id)]
      );
      target = rows?.[0] || null;
    }

    const paid_at = toMysqlDatetime(body.paid_at);
    const collected_by_staff_id = request.sqlStaffId ?? null;

    if (target) {
      await connection.query(
        `UPDATE member_fees
            SET status = ?, paid_amount = ?, payment_intent = ?, payment_method = ?,
                paid_at = ?, collected_by_staff_id = ?
          WHERE fee_id = ? AND company_id = ?`,
        [
          status,
          paidAmount,
          payment_intent,
          payment_method,
          paid_at,
          collected_by_staff_id,
          target.fee_id,
          Number(company_id),
        ]
      );
      return response
        .status(200)
        .json({ ok: true, fee_id: target.fee_id, created: false });
    }

    // No fee on record — the device was closed before fees existed, or the
    // charge was started straight from the header.
    const feeAmount = normalizeFeeAmount(body.fee_amount);
    if (!feeAmount.ok) {
      return response.status(400).json({ ok: false, msg: feeAmount.msg });
    }
    const [result] = await connection.query(
      `INSERT INTO member_fees
         (company_id, member_id, device_id, fee_amount, fee_reason, return_status,
          status, paid_amount, payment_intent, payment_method, paid_at, collected_by_staff_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(company_id),
        Number(member_id),
        Number(device_id),
        feeAmount.value === undefined || feeAmount.value === null
          ? paidAmount
          : feeAmount.value,
        body.fee_reason ? String(body.fee_reason).trim() : null,
        body.return_status ? String(body.return_status).trim().toLowerCase() : null,
        status,
        paidAmount,
        payment_intent,
        payment_method,
        paid_at,
        collected_by_staff_id,
      ]
    );
    return response
      .status(200)
      .json({ ok: true, fee_id: result.insertId, created: true });
  } catch (error) {
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error", error: error.message });
  }
};

// Read fees (B1.2) — the student profile's "Outstanding fees" section, the
// company-wide fees report and the badge on the member list all read this.
//
// The student's name is joined in so the company-wide report needs no second
// call. LEFT JOINs throughout: a debt must not disappear from the report because
// the roster row or the inventory item was removed.
const retrieveMemberFees = async (request, response) => {
  try {
    const body = request.body || {};
    const company_id = body.company_id ?? body.companyId;
    if (!company_id) {
      return response
        .status(400)
        .json({ ok: false, msg: "company_id is required" });
    }

    const status = body.status ? String(body.status).trim().toLowerCase() : null;
    if (status && !["outstanding", "paid", "waived"].includes(status)) {
      return response.status(400).json({
        ok: false,
        msg: "status must be 'outstanding', 'paid' or 'waived'.",
      });
    }

    // A read that quietly returns "no fees" would tell a school nobody owes
    // anything. If the table is missing, say so instead.
    if (!(await memberFeesTableExists())) {
      return response.status(503).json({
        ok: false,
        msg: "member_fees is not available — run mysql/migrations/add_member_fees.sql.",
      });
    }

    const values = [Number(company_id)];
    let filterClause = "";
    if (body.member_id !== undefined && body.member_id !== null) {
      filterClause += " AND mf.member_id = ?";
      values.push(Number(body.member_id));
    }
    if (status) {
      filterClause += " AND mf.status = ?";
      values.push(status);
    }

    const [rows] = await connection.query(
      `SELECT mf.fee_id, mf.member_id,
              mi.first_name AS member_first_name, mi.last_name AS member_last_name,
              mf.device_id, ii.serial_number, ii.category_name AS device_category_name,
              mf.fee_amount, mf.fee_reason, mf.status, mf.return_status,
              mf.payment_intent, mf.paid_amount, mf.payment_method, mf.paid_at,
              mf.collected_by_staff_id, mf.created_at
         FROM member_fees mf
         LEFT JOIN members_info mi ON mi.member_id = mf.member_id
         LEFT JOIN item_inv ii ON ii.item_id = mf.device_id
        WHERE mf.company_id = ?${filterClause}
        ORDER BY mf.fee_id DESC`,
      values
    );

    // DECIMAL comes back from the driver as a string; the contract types both
    // amounts as JSON numbers, and null must stay null (not become 0).
    const normalized = (rows || []).map((row) => ({
      ...row,
      fee_amount: row.fee_amount === null ? null : Number(row.fee_amount),
      paid_amount: row.paid_amount === null ? null : Number(row.paid_amount),
    }));

    return response
      .status(200)
      .json({ ok: true, count: normalized.length, rows: normalized });
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
        madl.member_id, madl.device_id, madl.company_id,
        madl.assigned_date, madl.expected_return_date, madl.location,
        DATEDIFF(NOW(), CAST(madl.expected_return_date AS DATETIME)) AS days_overdue,
        mi.first_name, mi.last_name, mi.email, mi.grade, mi.homeroom,
        mi.minor, mi.parent_guardian_first_name, mi.parent_guardian_email,
        ii.serial_number AS device_serial_number, ii.item_group AS device_item_group,
        ii.category_name AS device_category_name, ii.brand AS device_brand
      FROM member_assigned_device_lease madl
      JOIN members_info mi ON mi.member_id = madl.member_id
      LEFT JOIN item_inv ii ON ii.item_id = madl.device_id
      WHERE madl.company_id = ? AND madl.returned = 0
        AND madl.expected_return_date IS NOT NULL
        AND madl.expected_return_date <> ''
        AND CAST(madl.expected_return_date AS DATETIME) < NOW()${gradeClause}
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
// Migrado a cola (ver project_bulk_queue_migration_plan.md): sin
// member_ids/grade, esto toca TODOS los leases pendientes de la compañía --
// sin techo natural, mismo perfil de riesgo que insertBulkItem. El
// controller solo valida y resuelve la lista de leases en scope (lectura
// rápida, preserva el early-exit "sin leases" de siempre) y encola; las 2
// escrituras (marcar devuelto + reponer inventario) viven en
// queue/handlers/bulkReturnMemberLeases.js. Igual que insertBulkItem, usa
// waitForJobOutcome para responder con la misma forma de siempre en el caso
// típico (solo cae a 202+jobId si supera maxWaitMs).
function createBulkReturnMemberLeases({
  enqueueFn = enqueue,
  extractContextFn = extractJobContext,
  waitForJobOutcomeFn = waitForJobOutcome,
  maxWaitMs = 4000,
} = {}) {
  return async function bulkReturnMemberLeases(request, response) {
    try {
      const {
        company_id,
        member_ids,
        grade,
        return_status = "returned",
        condition_note = null,
        warehouse,
        logistic_status,
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

      // Resolve the outstanding leases in scope first so we know whether
      // there's anything to enqueue (preserves the "no leases" early exit).
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
        `SELECT madl.company_id, madl.member_id, madl.device_id
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

      const payload = { company_id, return_status, condition_note, warehouse, logistic_status, leases };
      const job = await enqueueFn("member:bulk-return-leases", payload, {
        context: extractContextFn(request),
      });

      const outcome = await waitForJobOutcomeFn(job, { maxWaitMs });
      if (outcome.outcome === "done") {
        return response.status(200).json({ ok: true, ...outcome.result });
      }
      if (outcome.outcome === "failed") {
        return response.status(500).json({
          ok: false,
          msg: outcome.job.lastError || "Bulk return failed",
        });
      }
      return response.status(202).json({
        ok: true,
        jobId: job.id,
        msg: "Request queued — still processing. Poll GET /api/jobs/owned/:jobId for the result.",
      });
    } catch (error) {
      return response
        .status(500)
        .json({ ok: false, msg: "Internal server error", error: error.message });
    }
  };
}
const bulkReturnMemberLeases = createBulkReturnMemberLeases();

// PUBLIC self-service lookup for the family portal ("My Devices").
// Verification is knowledge-based: the student ID (external_id) plus the
// matching email on file. For minors the parent/guardian (responsible party)
// email is required; adult students use their own email. Returns only
// device-lease data — no addresses or phone numbers.
const retrieveMyDevices = async (request, response) => {
  try {
    const { email, external_id } = request.body || {};
    if (!email || !external_id) {
      return response
        .status(400)
        .json({ ok: false, msg: "email and external_id are required" });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const [rows] = await connection.query(
      `SELECT member_id, first_name, last_name, email, grade, homeroom, minor,
              parent_guardian_first_name, parent_guardian_last_name, parent_guardian_email
       FROM members_info WHERE external_id = ? LIMIT 1`,
      [String(external_id).trim()]
    );
    const member = rows?.[0];
    const guardianEmail = member?.parent_guardian_email
      ? String(member.parent_guardian_email).trim().toLowerCase()
      : null;
    const studentEmail = member?.email ? String(member.email).trim().toLowerCase() : null;
    const isMinor = member ? Number(member.minor) === 1 : false;

    // minors: the representative's email is the credential; adults: their own
    const authorized = member
      ? isMinor
        ? guardianEmail && cleanEmail === guardianEmail
        : studentEmail && cleanEmail === studentEmail
      : false;
    if (!authorized) {
      // uniform response — do not reveal whether the student ID exists
      return response.status(404).json({
        ok: false,
        msg: isMinor && member
          ? "No record found. For students under 18, use the parent/guardian email on file."
          : "No record found for that student ID and email.",
      });
    }

    const [leases] = await connection.query(
      `SELECT madl.assigned_date, madl.expected_return_date,
              madl.returned, madl.return_status, madl.condition_note, madl.returned_date,
              ii.serial_number, ii.item_group, ii.category_name, ii.brand
       FROM member_assigned_device_lease madl
       LEFT JOIN item_inv ii ON ii.item_id = madl.device_id
       WHERE madl.member_id = ?
       ORDER BY madl.returned ASC, madl.expected_return_date ASC`,
      [member.member_id]
    );
    return response.status(200).json({
      ok: true,
      member: {
        first_name: member.first_name,
        last_name: member.last_name,
        grade: member.grade,
        homeroom: member.homeroom,
        minor: Number(member.minor),
        responsible_party: isMinor
          ? `${member.parent_guardian_first_name ?? ""} ${member.parent_guardian_last_name ?? ""}`.trim()
          : `${member.first_name} ${member.last_name}`,
        viewer: isMinor ? "representative" : "student",
      },
      leases,
    });
  } catch (error) {
    return response
      .status(500)
      .json({ ok: false, msg: "Internal server error" });
  }
};

module.exports = {
  insertNewMember,
  insertBulkMembers,
  createInsertBulkMembers,
  updateMemberInfo,
  deleteMember,
  retrieveMemberInfo,
  insertNewRowINMemberAssignedDeviceTableForLeaseTracking,
  updateMemberAssignedDeviceLeaseRow,
  settleMemberFee,
  retrieveMemberFees,
  normalizeFeeAmount,
  extractFeePayload,
  deleteMemberAssignedDeviceLeaseRows,
  retrieveMembersAssignedDevices,
  removeRowAssignedDeviceLeaseMember,
  retrieveOverdueLeases,
  bulkReturnMemberLeases,
  createBulkReturnMemberLeases,
  retrieveMyDevices,
};
