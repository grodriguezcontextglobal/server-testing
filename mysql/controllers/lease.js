require("dotenv").config();
const logger = require("../../helpers/logger");
const getConnection = require("../database/config");

// insertingNewLease
const insertingNewLease = async (request, response) => {
  const connection = getConnection();
  const subscription_initial_date = new Date();
  const {
    staff_admin_id,
    company_id,
    subscription_expected_return_data,
    location,
    staff_member_id,
    device_id,
    verification_id, // added
  } = request.body;

  // Basic validation to avoid undefined/empty values
  const fields = {
    staff_admin_id,
    company_id,
    subscription_expected_return_data,
    location,
    staff_member_id,
    device_id,
    verification_id,
  };

  const isEmpty = (v) =>
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim().length === 0) ||
    v === "undefined" ||
    v === "null";

  const missing = Object.entries(fields)
    .filter(([, value]) => isEmpty(value))
    .map(([key]) => key);

  if (missing.length > 0) {
    logger.warn(`Missing required fields: ${missing.join(", ")}`);
    return response
      .status(400)
      .json({
        ok: false,
        msg: `Missing required fields: ${missing.join(", ")}`,
      });
  }

  // Normalize date: allow string/Date; ensure it’s parsable
  const normalizeDate = (v) => {
    if (v instanceof Date) return v;
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d;
  };

  const expectedReturnDate = normalizeDate(subscription_expected_return_data);
  if (!expectedReturnDate) {
    return response.status(400).json({
      ok: false,
      msg: "Invalid subscription_expected_return_data. Provide a valid date.",
    });
  }

  const query = `
    INSERT INTO lease_info (
      staff_admin_id,
      company_id,
      subscription_expected_return_data,
      subscription_initial_date,
      location,
      staff_member_id,
      device_id,
      verification_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  const values = [
    staff_admin_id,
    company_id,
    subscription_expected_return_data,
    subscription_initial_date,
    location,
    staff_member_id,
    device_id,
    verification_id, // added
  ];

  const [result] = await connection.execute(query, values);

  return response.status(201).json({ ok: true, lease: result });
};

const insertingNewLeaseConsumer = async (request, response) => {
  try {
    const connection = getConnection();

    // Whitelist of insertable columns to prevent SQL injection and invalid keys
    const allowedColumns = [
      "staff_admin_id",
      "company_id",
      "subscription_expected_return_data",
      "subscription_initial_date",
      "location",
      "consumer_member_id",
      "device_id",
      "verification_id",
      // Optional common flags
      "subscription_current_in_use",
      "active",
    ];

    // Pick only allowed keys that are present in request body
    const body = request.body || {};
    let columns = allowedColumns.filter((key) =>
      Object.prototype.hasOwnProperty.call(body, key)
    );

    // Ensure we always set an initial date if not provided
    if (!columns.includes("subscription_initial_date")) {
      columns.push("subscription_initial_date");
      body.subscription_initial_date = new Date();
    }

    // Fail fast if nothing usable was provided
    if (columns.length === 0) {
      return response.status(400).json({
        ok: false,
        msg: "No valid fields provided to insert into lease_customer_info.",
      });
    }

    // Normalize date fields when present
    const normalizeDate = (v) => {
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    if (columns.includes("subscription_expected_return_data")) {
      const normalized = normalizeDate(body.subscription_expected_return_data);
      if (!normalized) {
        return response.status(400).json({
          ok: false,
          msg: "Invalid subscription_expected_return_data. Provide a valid date.",
        });
      }
      body.subscription_expected_return_data = normalized;
    }
    if (columns.includes("subscription_initial_date")) {
      const normalized = normalizeDate(body.subscription_initial_date);
      if (!normalized) {
        body.subscription_initial_date = new Date();
      } else {
        body.subscription_initial_date = normalized;
      }
    }

    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map((key) => body[key]);

    const query = `
      INSERT INTO lease_customer_info (${columns.join(", ")})
      VALUES (${placeholders})`;

    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      ok: true,
      lease: result,
      inserted_fields: columns,
    });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

// Columnas reales (information_schema de prod, 2026-10-19). Los nombres de
// columna de las dos consultas salían de las claves del body tal cual: con una
// clave inventada se podía inyectar SQL. Ahora una clave que no sea columna da
// 400 (ver whereFromBody).
const LEASE_INFO_COLUMNS = new Set([
  "staff_admin_id", "company_id", "subscription_initial_date", "subscription_expected_return_data",
  "subscription_returned_date", "subscription_current_in_use", "location", "staff_member_id",
  "device_id", "active", "date_assignment", "created_at", "updated_at", "verification_id",
]);
const LEASE_CUSTOMER_INFO_COLUMNS = new Set([
  "staff_admin_id", "company_id", "subscription_initial_date", "subscription_expected_return_date",
  "subscription_returned_date", "subscription_current_in_use", "location", "consumer_member_id",
  "device_id", "active", "date_assignment", "created_at", "updated_at",
  "subscription_expected_return_data", "verification_id",
]);

/** `{ where, values }` con las claves del body, o `{ error }` si alguna no es columna. */
const whereFromBody = (body, columns) => {
  const keys = Object.keys(body ?? {});
  if (keys.length === 0) return { error: "At least one filter is required." };
  const invalid = keys.filter((k) => !columns.has(k));
  if (invalid.length > 0) return { error: `Invalid field(s): ${invalid.join(", ")}` };
  return { where: keys.map((k) => `\`${k}\`=?`).join(" AND "), values: keys.map((k) => body[k]) };
};

const consultingLease = async (request, response) => {
  try {
    const connection = getConnection();
    const { where, values, error } = whereFromBody(request.body, LEASE_INFO_COLUMNS);
    if (error) return response.status(400).json({ ok: false, msg: error });

    const query = `SELECT * FROM lease_info WHERE ${where}`;
    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, lease: result });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const consultingConsumerLease = async (request, response) => {
  try {
    const connection = getConnection();
    const { where, values, error } = whereFromBody(request.body, LEASE_CUSTOMER_INFO_COLUMNS);
    if (error) return response.status(400).json({ ok: false, msg: error });

    const query = `SELECT * FROM lease_customer_info WHERE ${where}`;
    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, lease: result });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const updateLeaseInfo = async (request, response) => {
  try {
    const connection = getConnection();
    const body = request.body || {};

    const allowedUpdateColumns = [
      "subscription_returned_date",
      "subscription_current_in_use",
      "active",
      "location",
      "subscription_expected_return_data",
      "subscription_initial_date",
      "verification_id",
      "staff_member_id",
      "staff_admin_id",
    ];
    const identifierKeys = ["company_id", "device_id"];

    const isDefined = (v) => v !== undefined;
    const setKeys = allowedUpdateColumns.filter(
      (k) => Object.prototype.hasOwnProperty.call(body, k) && isDefined(body[k])
    );
    if (setKeys.length === 0) {
      return response
        .status(400)
        .json({ ok: false, msg: "No valid updatable fields provided." });
    }

    const missingIds = identifierKeys.filter(
      (k) => !Object.prototype.hasOwnProperty.call(body, k)
    );
    if (missingIds.length > 0) {
      return response
        .status(400)
        .json({
          ok: false,
          msg: `Missing identifiers: ${missingIds.join(", ")}`,
        });
    }

    const normalizeDate = (v) => {
      if (v === null) return null;
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    const dateFields = [
      "subscription_expected_return_data",
      "subscription_initial_date",
      "subscription_returned_date",
    ];
    for (const k of setKeys) {
      if (dateFields.includes(k)) {
        const normalized = normalizeDate(body[k]);
        if (normalized === null && body[k] !== null) {
          return response
            .status(400)
            .json({ ok: false, msg: `Invalid date value for ${k}.` });
        }
        body[k] = normalized;
      }
    }

    const setClause = setKeys.map((k) => `${k}=?`).join(", ");
    const whereClause = identifierKeys.map((k) => `${k}=?`).join(" AND ");
    const values = [
      ...setKeys.map((k) => body[k]),
      ...identifierKeys.map((k) => body[k]),
    ];

    const query = `UPDATE lease_info SET ${setClause} WHERE ${whereClause}`;
    const [result] = await connection.execute(query, values);
    return response
      .status(200)
      .json({ ok: true, items: result.affectedRows, updated_fields: setKeys });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const updateConsumerLeaseInfo = async (request, response) => {
  try {
    const connection = getConnection();
    const body = request.body || {};

    const allowedUpdateColumns = [
      "subscription_returned_date",
      "subscription_current_in_use",
      "active",
      "location",
      "subscription_expected_return_data",
      "subscription_initial_date",
      "verification_id",
      "staff_admin_id",
    ];
    const identifierKeys = ["company_id", "consumer_member_id", "device_id"];

    const isDefined = (v) => v !== undefined;
    const setKeys = allowedUpdateColumns.filter(
      (k) => Object.prototype.hasOwnProperty.call(body, k) && isDefined(body[k])
    );
    if (setKeys.length === 0) {
      return response
        .status(400)
        .json({ ok: false, msg: "No valid updatable fields provided." });
    }

    const missingIds = identifierKeys.filter(
      (k) => !Object.prototype.hasOwnProperty.call(body, k)
    );
    if (missingIds.length > 0) {
      return response
        .status(400)
        .json({
          ok: false,
          msg: `Missing identifiers: ${missingIds.join(", ")}`,
        });
    }

    const normalizeDate = (v) => {
      if (v === null) return null;
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    const dateFields = [
      "subscription_expected_return_data",
      "subscription_initial_date",
      "subscription_returned_date",
    ];
    for (const k of setKeys) {
      if (dateFields.includes(k)) {
        const normalized = normalizeDate(body[k]);
        if (normalized === null && body[k] !== null) {
          return response
            .status(400)
            .json({ ok: false, msg: `Invalid date value for ${k}.` });
        }
        body[k] = normalized;
      }
    }

    const setClause = setKeys.map((k) => `${k}=?`).join(", ");
    const whereClause = identifierKeys.map((k) => `${k}=?`).join(" AND ");
    const values = [
      ...setKeys.map((k) => body[k]),
      ...identifierKeys.map((k) => body[k]),
    ];

    const query = `UPDATE lease_customer_info SET ${setClause} WHERE ${whereClause}`;
    const [result] = await connection.execute(query, values);
    return response
      .status(200)
      .json({ ok: true, items: result.affectedRows, updated_fields: setKeys });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteLeaseInfo = async (request, response) => {
  try {
    const connection = getConnection();
    const { company_id, staff_member_id, device_id } = request.body;

    const query = `
      DELETE FROM lease_info 
      WHERE company_id=? AND staff_member_id=? AND device_id=?`;

    const values = [company_id, staff_member_id, device_id];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, items: result.affectedRows });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteConsumerLeaseInfo = async (request, response) => {
  try {
    const connection = getConnection();
    const { company_id, consumer_member_id, device_id } = request.body;

    const query = `
      DELETE FROM lease_customer_info 
      WHERE company_id=? AND consumer_member_id=? AND device_id=?`;

    const values = [company_id, consumer_member_id, device_id];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({ ok: true, items: result.affectedRows });
  } catch (error) {
    logger.error("Error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

// ─── Unified device-lease status (all tracks) ───────────────────────────────
// Reads the `all_device_leases` view, which normalizes the three lease tracks
// (staff / consumer / member) into one shape. Company-scoped (multi-tenant).
const LEASE_TYPES = ["staff", "consumer", "member"];

// Pure + exported so the classification is unit-testable without a DB.
// `now` is injectable for deterministic tests.
const classifyLease = (row, now = Date.now()) => {
  const outstanding = Number(row.outstanding) === 1;
  const due = row.expected_return_date
    ? new Date(row.expected_return_date).getTime()
    : NaN;
  const overdue = outstanding && !Number.isNaN(due) && due < now;
  let status;
  if (row.return_status === "lost" || row.return_status === "damaged") {
    status = row.return_status; // explicit end-state (member track) wins
  } else if (overdue) {
    status = "overdue";
  } else if (outstanding) {
    status = "outstanding";
  } else {
    status = "returned";
  }
  return { outstanding, overdue, status };
};

// POST /api/db_lease/status  { company_id, lessee_type?, only_overdue? }
// Returns a per-lease status list + a company-wide summary (for dashboards).
const retrieveLeaseStatus = async (request, response) => {
  const connection = getConnection();
  const { company_id, lessee_type, only_overdue } = request.body || {};

  if (company_id === undefined || company_id === null || String(company_id).trim() === "") {
    return response.status(400).json({ ok: false, msg: "company_id is required" });
  }
  if (lessee_type && !LEASE_TYPES.includes(lessee_type)) {
    return response
      .status(400)
      .json({ ok: false, msg: `lessee_type must be one of: ${LEASE_TYPES.join(", ")}` });
  }

  const where = ["company_id = ?"];
  const values = [company_id];
  if (lessee_type) {
    where.push("lessee_type = ?");
    values.push(lessee_type);
  }

  try {
    const [rows] = await connection.execute(
      `SELECT lessee_type, lease_key, lessee_id, assigned_by, device_id, company_id,
              assigned_date, expected_return_date, returned_date, outstanding,
              location, return_status, condition_note
         FROM all_device_leases
        WHERE ${where.join(" AND ")}`,
      values
    );

    const now = Date.now();
    const leases = rows.map((r) => ({ ...r, ...classifyLease(r, now) }));

    // Summary is always over the full (company + type) set so dashboard totals
    // stay meaningful; the returned list can be narrowed with only_overdue.
    const summary = {
      total: leases.length,
      outstanding: leases.filter((l) => l.outstanding).length,
      overdue: leases.filter((l) => l.overdue).length,
      returned: leases.filter((l) => l.status === "returned").length,
      lost: leases.filter((l) => l.status === "lost").length,
      damaged: leases.filter((l) => l.status === "damaged").length,
      by_type: LEASE_TYPES.reduce((acc, t) => {
        acc[t] = leases.filter((l) => l.lessee_type === t).length;
        return acc;
      }, {}),
    };

    const items = only_overdue ? leases.filter((l) => l.overdue) : leases;
    return response.status(200).json({ ok: true, summary, leases: items });
  } catch (error) {
    logger.error("retrieveLeaseStatus error:", error.message);
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  insertingNewLease,
  insertingNewLeaseConsumer,
  consultingLease,
  consultingConsumerLease,
  updateLeaseInfo,
  updateConsumerLeaseInfo,
  deleteLeaseInfo,
  deleteConsumerLeaseInfo,
  retrieveLeaseStatus,
  classifyLease,
};
