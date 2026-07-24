require("dotenv").config();
const { randomUUID } = require("crypto");
const logger = require("../../helpers/logger");
const getConnection = require("../database/config");
const StaffActivityLog = require("../../models/StaffActivityLog");
const { isUnder13 } = require("../helpers/ageCalc");
const { generateOtc, otcExpiresAt, isOtcExpired, isConsentMutable, isValidDecision } = require("../helpers/consentOtc");

const hasBlankRequiredId = (value) =>
  value === undefined || value === null || String(value).trim() === "";

const validateStudentRequest = ({ company_id, member_id }) => {
  if (hasBlankRequiredId(company_id)) return "company_id is required";
  if (hasBlankRequiredId(member_id)) return "member_id is required";
  return null;
};

const logDisclosure = async (payload) => {
  if (!payload?.staff_member_id || typeof StaffActivityLog.create !== "function") return;
  try {
    await StaffActivityLog.create(payload);
  } catch (error) {
    logger.error("disclosure audit log error:", error.message);
  }
};

// PURE: classify one member device lease from its raw columns.
const classifyMemberLease = (row, now = Date.now()) => {
  const outstanding = Number(row.returned) === 0;
  const due = row.expected_return_date ? new Date(row.expected_return_date).getTime() : NaN;
  const overdue = outstanding && !Number.isNaN(due) && due < now;
  return { outstanding, overdue };
};

/**
 * PURE + exported: member-lease rows -> { summary, by_grade }. Deterministic
 * given `now`. Powers the 1:1 device-program dashboard.
 */
const buildSchoolDashboard = (rows = [], { now = Date.now() } = {}) => {
  const summary = {
    total_leases: rows.length,
    outstanding: 0,
    overdue: 0,
    returned: 0,
    lost: 0,
    damaged: 0,
    students_with_devices: 0,
  };
  const byGrade = {};
  const students = new Set();

  for (const row of rows) {
    if (row.member_id !== undefined && row.member_id !== null) students.add(row.member_id);
    const { outstanding, overdue } = classifyMemberLease(row, now);

    if (outstanding) summary.outstanding++;
    else if (row.return_status === "lost") summary.lost++;
    else if (row.return_status === "damaged") summary.damaged++;
    else summary.returned++;
    if (overdue) summary.overdue++;

    const g = row.grade && String(row.grade).trim() ? String(row.grade).trim() : "Unassigned";
    if (!byGrade[g]) byGrade[g] = { total: 0, outstanding: 0, overdue: 0 };
    byGrade[g].total++;
    if (outstanding) byGrade[g].outstanding++;
    if (overdue) byGrade[g].overdue++;
  }

  summary.students_with_devices = students.size;
  return { summary, by_grade: byGrade };
};

// POST /api/school/dashboard  { company_id }
// 1:1 device-program summary for the company: lease status counts + per-grade
// breakdown + student totals. Education-gated at the route.
const schoolDashboard = async (req, res) => {
  const connection = getConnection();
  const { company_id } = req.body || {};
  if (company_id === undefined || company_id === null || String(company_id).trim() === "") {
    return res.status(400).json({ ok: false, msg: "company_id is required" });
  }
  try {
    const [rows] = await connection.query(
      `SELECT madl.member_id, madl.returned, madl.return_status, madl.expected_return_date,
              mi.grade, mi.homeroom
         FROM member_assigned_device_lease madl
         JOIN members_info mi ON mi.member_id = madl.member_id AND mi.company_id = madl.company_id
        WHERE madl.company_id = ?`,
      [company_id]
    );
    const [[cnt]] = await connection.query(
      "SELECT COUNT(*) AS total FROM members_info WHERE company_id = ?",
      [company_id]
    );
    const dashboard = buildSchoolDashboard(rows, { now: Date.now() });
    dashboard.summary.total_students = Number(cnt.total);
    return res.status(200).json({ ok: true, ...dashboard });
  } catch (error) {
    logger.error("schoolDashboard error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/roster  { company_id, grade?, homeroom? }
// Students for the company (optionally filtered by grade/homeroom) with a count
// of devices currently out per student.
const schoolRoster = async (req, res) => {
  const connection = getConnection();
  const { company_id, grade, homeroom } = req.body || {};
  if (company_id === undefined || company_id === null || String(company_id).trim() === "") {
    return res.status(400).json({ ok: false, msg: "company_id is required" });
  }
  const where = ["mi.company_id = ?"];
  const values = [company_id];
  if (grade !== undefined && grade !== null && String(grade).trim() !== "") {
    where.push("mi.grade = ?");
    values.push(String(grade).trim());
  }
  if (homeroom !== undefined && homeroom !== null && String(homeroom).trim() !== "") {
    where.push("mi.homeroom = ?");
    values.push(String(homeroom).trim());
  }
  try {
    const [rows] = await connection.query(
      `SELECT mi.member_id, mi.first_name, mi.last_name, mi.email, mi.grade, mi.homeroom, mi.minor,
              SUM(CASE WHEN madl.returned = 0 THEN 1 ELSE 0 END) AS devices_out
         FROM members_info mi
         LEFT JOIN member_assigned_device_lease madl
           ON madl.member_id = mi.member_id AND madl.company_id = mi.company_id
        WHERE ${where.join(" AND ")}
        GROUP BY mi.member_id, mi.first_name, mi.last_name, mi.email, mi.grade, mi.homeroom, mi.minor
        ORDER BY mi.grade, mi.homeroom, mi.last_name, mi.first_name`,
      values
    );
    const students = rows.map((r) => ({ ...r, devices_out: Number(r.devices_out) || 0 }));
    return res.status(200).json({ ok: true, count: students.length, students });
  } catch (error) {
    logger.error("schoolRoster error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

/**
 * PURE + exported: merge normalized student_guardian rows with the single embedded
 * guardian on members_info. The embedded one is prepended as source:'embedded'
 * (primary) unless a normalized guardian already has the same email.
 */
const mergeGuardians = (normalized = [], embedded = null) => {
  const list = normalized.map((g) => ({
    id: g.id,
    first_name: g.first_name,
    last_name: g.last_name,
    email: g.email,
    phone_number: g.phone_number,
    relationship: g.relationship || null,
    is_primary: Number(g.is_primary) === 1,
    source: "normalized",
  }));
  const hasEmbedded =
    embedded &&
    (embedded.parent_guardian_email ||
      embedded.parent_guardian_first_name ||
      embedded.parent_guardian_last_name);
  if (hasEmbedded) {
    const dupe =
      embedded.parent_guardian_email &&
      list.some(
        (g) =>
          g.email &&
          String(g.email).toLowerCase() === String(embedded.parent_guardian_email).toLowerCase()
      );
    if (!dupe) {
      list.unshift({
        id: null,
        first_name: embedded.parent_guardian_first_name || null,
        last_name: embedded.parent_guardian_last_name || null,
        email: embedded.parent_guardian_email || null,
        phone_number: embedded.parent_guardian_phone_number || null,
        relationship: "guardian",
        is_primary: true,
        source: "embedded",
      });
    }
  }
  return list;
};

// POST /api/school/student/export  { company_id, member_id }
// Portable FERPA/COPPA student data export: identity, guardians, leases,
// consents, and the audited access log for this student.
const studentExport = async (req, res) => {
  const connection = getConnection();
  const { company_id, member_id } = req.body || {};
  const validationError = validateStudentRequest({ company_id, member_id });
  if (validationError) return res.status(400).json({ ok: false, msg: validationError });

  try {
    const [studentRows] = await connection.query(
      "SELECT * FROM members_info WHERE member_id = ? AND company_id = ? LIMIT 1",
      [member_id, company_id]
    );
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ ok: false, msg: "member not found in this company" });
    }

    const [normalizedGuardians] = await connection.query(
      `SELECT g.id, g.first_name, g.last_name, g.email, g.phone_number,
              sg.relationship, sg.is_primary
         FROM student_guardian sg
         JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.company_id = ? AND sg.member_id = ?`,
      [company_id, member_id]
    );
    const guardians = mergeGuardians(normalizedGuardians, student);

    const [leases] = await connection.query(
      `SELECT * FROM member_assigned_device_lease
        WHERE member_id = ? AND company_id = ?
        ORDER BY assigned_date DESC`,
      [member_id, company_id]
    );
    const [consents] = await connection.query(
      `SELECT * FROM school_consent
        WHERE member_id = ? AND company_id = ?
        ORDER BY consented_at DESC`,
      [member_id, company_id]
    );
    const access_log = await StaffActivityLog.find({
      company_id: String(company_id),
      target_id: String(member_id),
    })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    await logDisclosure({
      staff_member_id: req.uid,
      company_id: String(company_id),
      action: "DISCLOSURE",
      target_model: "SchoolPII",
      target_id: String(member_id),
      details: {
        type: "student_export",
        purpose: "FERPA data-subject request",
        recipient: "staff",
        fields_exported: ["identity", "guardians", "leases", "consents", "access_log"],
      },
    });

    return res.status(200).json({ ok: true, student, guardians, leases, consents, access_log });
  } catch (error) {
    logger.error("studentExport error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

const ANONYMIZE_MEMBER_SQL = `UPDATE members_info
   SET first_name = 'REDACTED',
       last_name = 'REDACTED',
       email = NULL,
       phone_number = NULL,
       address = NULL,
       address_street = NULL,
       address_city = NULL,
       address_state = NULL,
       address_zip = NULL,
       parent_guardian_first_name = NULL,
       parent_guardian_last_name = NULL,
       parent_guardian_email = NULL,
       parent_guardian_phone_number = NULL,
       external_id = NULL,
       image_url = NULL
 WHERE member_id = ? AND company_id = ?`;

const anonymizeStudent = async (conn, company_id, member_id) => {
  const [memberResult] = await conn.execute(ANONYMIZE_MEMBER_SQL, [member_id, company_id]);
  const [guardianResult] = await conn.execute(
    `UPDATE guardians g
      JOIN student_guardian sg ON sg.guardian_id = g.id AND sg.company_id = g.company_id
       SET g.first_name = 'REDACTED',
           g.last_name = 'REDACTED',
           g.email = NULL,
           g.phone_number = NULL
     WHERE sg.member_id = ? AND sg.company_id = ?`,
    [member_id, company_id]
  );
  const [consentResult] = await conn.execute(
    `UPDATE school_consent
        SET signer_name = 'REDACTED', signer_email = NULL
      WHERE member_id = ? AND company_id = ?`,
    [member_id, company_id]
  );

  return {
    members_info_updated: Number(memberResult.affectedRows || 0) > 0,
    guardians_anonymized: Number(guardianResult.affectedRows || 0),
    consents_anonymized: Number(consentResult.affectedRows || 0),
  };
};

const deleteStudent = async (conn, company_id, member_id) => {
  const [guardianRows] = await conn.execute(
    "SELECT guardian_id FROM student_guardian WHERE member_id = ? AND company_id = ?",
    [member_id, company_id]
  );
  const guardianIds = guardianRows.map((row) => row.guardian_id).filter(Boolean);
  let guardiansDeleted = 0;
  if (guardianIds.length) {
    const placeholders = guardianIds.map(() => "?").join(", ");
    const [guardianResult] = await conn.execute(
      `DELETE FROM guardians WHERE company_id = ? AND id IN (${placeholders})`,
      [company_id, ...guardianIds]
    );
    guardiansDeleted = Number(guardianResult.affectedRows || 0);
  }
  const [linkResult] = await conn.execute(
    "DELETE FROM student_guardian WHERE member_id = ? AND company_id = ?",
    [member_id, company_id]
  );
  const [consentResult] = await conn.execute(
    "DELETE FROM school_consent WHERE member_id = ? AND company_id = ?",
    [member_id, company_id]
  );
  const [memberResult] = await conn.execute(
    "DELETE FROM members_info WHERE member_id = ? AND company_id = ?",
    [member_id, company_id]
  );

  return {
    members_info_deleted: Number(memberResult.affectedRows || 0) > 0,
    guardians_deleted: guardiansDeleted,
    student_guardian_links_deleted: Number(linkResult.affectedRows || 0),
    consents_deleted: Number(consentResult.affectedRows || 0),
  };
};

// POST /api/school/student/erase  { company_id, member_id, mode? }
// Strip student PII while preserving asset history by default; hard-delete only
// the student/guardian/consent records when explicitly requested.
const studentErase = async (req, res) => {
  const pool = getConnection();
  const { company_id, member_id } = req.body || {};
  const mode = req.body?.mode || "anonymize";
  const validationError = validateStudentRequest({ company_id, member_id });
  if (validationError) return res.status(400).json({ ok: false, msg: validationError });
  if (!["anonymize", "delete"].includes(mode)) {
    return res.status(400).json({ ok: false, msg: "mode must be anonymize or delete" });
  }

  try {
    const [studentRows] = await pool.execute(
      "SELECT 1 FROM members_info WHERE member_id = ? AND company_id = ? LIMIT 1",
      [member_id, company_id]
    );
    if (!studentRows.length) {
      return res.status(404).json({ ok: false, msg: "member not found in this company" });
    }

    const [[leaseCount]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM member_assigned_device_lease WHERE member_id = ? AND company_id = ?",
      [member_id, company_id]
    );
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const receipt =
        mode === "delete"
          ? await deleteStudent(conn, company_id, member_id)
          : await anonymizeStudent(conn, company_id, member_id);
      receipt.leases_preserved = Number(leaseCount.total || 0);
      await conn.commit();
      await logDisclosure({
        staff_member_id: req.uid,
        company_id: String(company_id),
        action: "DISCLOSURE",
        target_model: "SchoolPII",
        target_id: String(member_id),
        details: {
          type: "student_erase",
          purpose: "FERPA/COPPA data-subject request",
          mode,
          receipt,
        },
      });
      return res.status(200).json({ ok: true, mode, member_id, receipt });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    logger.error("studentErase error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/student/access-log  { company_id, member_id, type? }
// Per-student access + disclosure history for FERPA record requests.
const studentAccessLog = async (req, res) => {
  const { company_id, member_id, type } = req.body || {};
  const validationError = validateStudentRequest({ company_id, member_id });
  if (validationError) return res.status(400).json({ ok: false, msg: validationError });
  if (type && !["access", "disclosure"].includes(type)) {
    return res.status(400).json({ ok: false, msg: "type must be access or disclosure" });
  }

  const filter = {
    company_id: String(company_id),
    target_id: String(member_id),
  };
  if (type === "access") filter.action = { $in: ["READ", "CREATE", "UPDATE", "DELETE"] };
  else if (type === "disclosure") filter.action = "DISCLOSURE";

  try {
    const logs = await StaffActivityLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();
    const access_log = logs.map((log) => ({
      id: log.id || (log._id ? String(log._id) : undefined),
      action: log.action,
      staff_member_id: log.staff_member_id,
      timestamp: log.timestamp,
      details: log.details || {},
    }));
    return res.status(200).json({ ok: true, member_id, access_log, count: access_log.length });
  } catch (error) {
    logger.error("studentAccessLog error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/guardians  { company_id, member_id }
const listStudentGuardians = async (req, res) => {
  const connection = getConnection();
  const { company_id, member_id } = req.body || {};
  if (!company_id || member_id === undefined || member_id === null || String(member_id).trim() === "") {
    return res.status(400).json({ ok: false, msg: "company_id and member_id are required" });
  }
  try {
    const [normalized] = await connection.query(
      `SELECT g.id, g.first_name, g.last_name, g.email, g.phone_number,
              sg.relationship, sg.is_primary
         FROM student_guardian sg
         JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.company_id = ? AND sg.member_id = ?`,
      [company_id, member_id]
    );
    const [embRows] = await connection.query(
      `SELECT parent_guardian_first_name, parent_guardian_last_name,
              parent_guardian_email, parent_guardian_phone_number
         FROM members_info WHERE company_id = ? AND member_id = ? LIMIT 1`,
      [company_id, member_id]
    );
    const guardians = mergeGuardians(normalized, embRows[0] || null);
    return res.status(200).json({ ok: true, count: guardians.length, guardians });
  } catch (error) {
    logger.error("listStudentGuardians error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/guardians/add
// { company_id, member_id, first_name?, last_name?, email?, phone_number?, relationship?, is_primary? }
const addStudentGuardian = async (req, res) => {
  const pool = getConnection();
  const {
    company_id,
    member_id,
    first_name,
    last_name,
    email,
    phone_number,
    relationship,
    is_primary,
  } = req.body || {};
  if (!company_id || member_id === undefined || member_id === null || String(member_id).trim() === "") {
    return res.status(400).json({ ok: false, msg: "company_id and member_id are required" });
  }
  if (!first_name && !last_name && !email) {
    return res
      .status(400)
      .json({ ok: false, msg: "provide at least a name or email for the guardian" });
  }
  try {
    // multi-tenant guard: the student must belong to this company
    const [m] = await pool.execute(
      "SELECT 1 FROM members_info WHERE member_id = ? AND company_id = ? LIMIT 1",
      [member_id, company_id]
    );
    if (!m.length) {
      return res.status(404).json({ ok: false, msg: "member not found in this company" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const guardianId = randomUUID();
      await conn.execute(
        `INSERT INTO guardians (id, company_id, first_name, last_name, email, phone_number)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [guardianId, company_id, first_name || null, last_name || null, email || null, phone_number || null]
      );
      const linkId = randomUUID();
      await conn.execute(
        `INSERT INTO student_guardian (id, company_id, member_id, guardian_id, relationship, is_primary)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [linkId, company_id, member_id, guardianId, relationship || null, is_primary ? 1 : 0]
      );
      await conn.commit();
      return res.status(201).json({ ok: true, guardian_id: guardianId });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    logger.error("addStudentGuardian error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// PURE + exported: roster rows carrying a `consented` flag -> compliance summary
// (who has / hasn't signed). Deterministic, no I/O.
const summarizeConsentStatus = (rows = []) => {
  let consented = 0;
  const missing = [];
  for (const r of rows) {
    if (Number(r.consented) === 1 || r.consented === true) {
      consented++;
    } else {
      const missingMember = {
        member_id: r.member_id,
        first_name: r.first_name,
        last_name: r.last_name,
        grade: r.grade || null,
      };
      if (r.under_13 !== undefined) missingMember.under_13 = r.under_13;
      missing.push(missingMember);
    }
  }
  return { total: rows.length, consented, missing_count: missing.length, missing };
};

// POST /api/school/consent/record
// { company_id, member_id, signer_name, policy_type?='AUP', policy_version?='1',
//   guardian_id?, signer_email?, method?='e-signature' }
const recordConsent = async (req, res) => {
  const pool = getConnection();
  const {
    company_id, member_id, policy_type, policy_version,
    guardian_id, signer_name, signer_email, method,
  } = req.body || {};
  if (!company_id || member_id === undefined || member_id === null || String(member_id).trim() === "") {
    return res.status(400).json({ ok: false, msg: "company_id and member_id are required" });
  }
  if (!signer_name || !String(signer_name).trim()) {
    return res.status(400).json({ ok: false, msg: "signer_name is required" });
  }
  try {
    const [m] = await pool.execute(
      "SELECT 1 FROM members_info WHERE member_id = ? AND company_id = ? LIMIT 1",
      [member_id, company_id]
    );
    if (!m.length) {
      return res.status(404).json({ ok: false, msg: "member not found in this company" });
    }
    const pType = policy_type && String(policy_type).trim() ? String(policy_type).trim() : "AUP";
    const pVer = policy_version && String(policy_version).trim() ? String(policy_version).trim() : "1";
    const id = randomUUID();
    try {
      await pool.execute(
        `INSERT INTO school_consent
           (id, company_id, member_id, guardian_id, policy_type, policy_version, signer_name, signer_email, method, consented_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'agreed')`,
        [id, company_id, member_id, guardian_id || null, pType, pVer, String(signer_name).trim(), signer_email || null, method || "e-signature"]
      );
      return res.status(201).json({ ok: true, consent_id: id });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(200).json({ ok: true, msg: "consent already recorded for this member/policy/version" });
      }
      throw e;
    }
  } catch (error) {
    logger.error("recordConsent error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/consent/request
// Staff creates a consent request -> generates OTC -> sends email to guardian.
const requestConsent = async (req, res) => {
  const pool = getConnection();
  const { company_id, member_id, guardian_id, policy_type, policy_version } = req.body || {};

  if (!company_id || member_id === undefined || member_id === null || String(member_id).trim() === "") {
    return res.status(400).json({ ok: false, msg: "company_id and member_id are required" });
  }

  const pType = policy_type && String(policy_type).trim() ? String(policy_type).trim() : "AUP";
  const pVer = policy_version && String(policy_version).trim() ? String(policy_version).trim() : "1";

  try {
    const [m] = await pool.execute(
      "SELECT member_id, first_name, last_name, minor FROM members_info WHERE member_id = ? AND company_id = ? LIMIT 1",
      [member_id, company_id]
    );
    if (!m.length) {
      return res.status(404).json({ ok: false, msg: "member not found in this company" });
    }
    const student = m[0];

    let guardianEmail = null;
    let guardianName = null;
    let resolvedGuardianId = guardian_id || null;

    if (resolvedGuardianId) {
      const [g] = await pool.execute(
        "SELECT first_name, last_name, email FROM guardians WHERE id = ? AND company_id = ?",
        [resolvedGuardianId, company_id]
      );
      if (g.length) {
        guardianEmail = g[0].email;
        guardianName = `${g[0].first_name || ""} ${g[0].last_name || ""}`.trim();
      }
    }

    if (!guardianEmail) {
      const [sg] = await pool.execute(
        `SELECT g.id, g.first_name, g.last_name, g.email
           FROM student_guardian sg JOIN guardians g ON g.id = sg.guardian_id
          WHERE sg.company_id = ? AND sg.member_id = ? LIMIT 1`,
        [company_id, member_id]
      );
      if (sg.length && sg[0].email) {
        resolvedGuardianId = sg[0].id;
        guardianEmail = sg[0].email;
        guardianName = `${sg[0].first_name || ""} ${sg[0].last_name || ""}`.trim();
      }
    }

    if (!guardianEmail) {
      const [emb] = await pool.execute(
        "SELECT parent_guardian_email, parent_guardian_first_name, parent_guardian_last_name FROM members_info WHERE member_id = ? AND company_id = ? LIMIT 1",
        [member_id, company_id]
      );
      if (emb.length && emb[0].parent_guardian_email) {
        guardianEmail = emb[0].parent_guardian_email;
        guardianName = `${emb[0].parent_guardian_first_name || ""} ${emb[0].parent_guardian_last_name || ""}`.trim();
      }
    }

    if (!guardianEmail) {
      return res.status(422).json({ ok: false, msg: "No guardian email found for this student. Add a guardian first." });
    }

    const otc = generateOtc();
    const expires = otcExpiresAt();
    const id = randomUUID();

    await pool.execute(
      `INSERT INTO school_consent
        (id, company_id, member_id, guardian_id, policy_type, policy_version,
         signer_name, signer_email, method, status, otc, otc_expires_at,
         requested_at, requester_staff_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), ?)`,
      [
        id,
        company_id,
        member_id,
        resolvedGuardianId,
        pType,
        pVer,
        guardianName || "Guardian",
        guardianEmail,
        "email-link",
        otc,
        expires,
        req.uid || null,
      ]
    );

    try {
      const { enqueue } = require("../../helpers/queue");
      const consentUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/school/consent/respond?otc=${otc}`;
      await enqueue(
        "send-email",
        {
          to: guardianEmail,
          from: "Devitrak Notifications <noreply@devitrak.com>",
          subject: `Consent Required: Device Agreement for ${student.first_name} ${student.last_name}`,
          html: `
          <p>Hello ${guardianName || "Guardian"},</p>
          <p>A device assignment agreement requires your consent for <strong>${student.first_name} ${student.last_name}</strong>.</p>
          <p>Please review and respond to the consent request:</p>
          <p><a href="${consentUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px;">Review Consent</a></p>
          <p>Or copy this link: ${consentUrl}</p>
          <p>This link expires in 7 days.</p>
          <p>Best regards,<br/>Devitrak</p>
        `,
        },
        { idempotencyKey: `school-consent-request:${id}` }
      );
    } catch (emailErr) {
      logger.error("Failed to enqueue consent email:", emailErr.message);
    }

    return res.status(201).json({
      ok: true,
      consent_id: id,
      status: "pending",
      expires_at: expires,
      guardian_email: guardianEmail,
    });
  } catch (error) {
    logger.error("requestConsent error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/consent/public/retrieve
// Public: guardian reads consent record via OTC.
const publicRetrieveConsent = async (req, res) => {
  const pool = getConnection();
  const { otc } = req.body || {};
  const token = otc ? String(otc).trim() : "";

  if (!token) {
    return res.status(400).json({ ok: false, msg: "otc is required" });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, company_id, member_id, status, policy_type, policy_version,
              signer_name, signer_email, otc_expires_at, consented_at, refused_at, responded_at
         FROM school_consent WHERE otc = ?`,
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, msg: "Invalid consent link." });
    }

    const consent = rows[0];
    if (isOtcExpired(consent.otc_expires_at)) {
      return res.status(410).json({ ok: false, code: "CONSENT_LINK_EXPIRED", msg: "This consent link has expired." });
    }

    if (!isConsentMutable(consent.status)) {
      return res.status(200).json({
        ok: true,
        consent: {
          id: consent.id,
          status: consent.status,
          policy_type: consent.policy_type,
          policy_version: consent.policy_version,
          consented_at: consent.consented_at,
          refused_at: consent.refused_at,
          responded_at: consent.responded_at,
        },
      });
    }

    const [student] = await pool.execute(
      "SELECT first_name, last_name FROM members_info WHERE member_id = ? AND company_id = ? LIMIT 1",
      [consent.member_id, consent.company_id]
    );

    return res.status(200).json({
      ok: true,
      consent: {
        id: consent.id,
        status: consent.status,
        policy_type: consent.policy_type,
        policy_version: consent.policy_version,
        signer_name: consent.signer_name,
        student_name: student.length ? `${student[0].first_name} ${student[0].last_name}` : "Student",
        expires_at: consent.otc_expires_at,
      },
    });
  } catch (error) {
    logger.error("publicRetrieveConsent error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/consent/public/respond
// Public: guardian agrees or refuses consent via OTC.
const publicRespondConsent = async (req, res) => {
  const pool = getConnection();
  const { otc, decision, signer_name } = req.body || {};
  const token = otc ? String(otc).trim() : "";

  if (!token) {
    return res.status(400).json({ ok: false, msg: "otc is required" });
  }
  if (!isValidDecision(decision)) {
    return res.status(400).json({ ok: false, msg: "decision must be 'agreed' or 'refused'" });
  }
  if (!signer_name || !String(signer_name).trim()) {
    return res.status(400).json({ ok: false, msg: "signer_name is required" });
  }

  try {
    const [rows] = await pool.execute(
      "SELECT id, status, otc_expires_at FROM school_consent WHERE otc = ?",
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, msg: "Invalid consent link." });
    }

    const consent = rows[0];
    if (isOtcExpired(consent.otc_expires_at)) {
      return res.status(410).json({ ok: false, code: "CONSENT_LINK_EXPIRED", msg: "This consent link has expired." });
    }

    if (!isConsentMutable(consent.status)) {
      return res.status(200).json({
        ok: true,
        msg: `Consent already ${consent.status}.`,
        status: consent.status,
      });
    }

    const ip = req.ip || req.connection?.remoteAddress || "";
    const userAgent = req.get("user-agent") || "";
    const statusField = decision === "agreed" ? "consented_at" : "refused_at";
    await pool.execute(
      `UPDATE school_consent
         SET status = ?, signer_name = ?, ${statusField} = NOW(), responded_at = NOW(),
             response_ip = ?, response_user_agent = ?
       WHERE id = ?`,
      [decision, String(signer_name).trim(), ip, userAgent, consent.id]
    );

    return res.status(200).json({ ok: true, status: decision, consent_id: consent.id });
  } catch (error) {
    logger.error("publicRespondConsent error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/consent  { company_id, member_id }  -> consents for a student
const listMemberConsents = async (req, res) => {
  const connection = getConnection();
  const { company_id, member_id } = req.body || {};
  if (!company_id || member_id === undefined || member_id === null || String(member_id).trim() === "") {
    return res.status(400).json({ ok: false, msg: "company_id and member_id are required" });
  }
  try {
    const [rows] = await connection.query(
      `SELECT id, guardian_id, policy_type, policy_version, signer_name, signer_email, method,
              consented_at, status, otc_expires_at, requested_at, responded_at, refused_at
         FROM school_consent WHERE company_id = ? AND member_id = ?
        ORDER BY consented_at DESC`,
      [company_id, member_id]
    );
    return res.status(200).json({ ok: true, count: rows.length, consents: rows });
  } catch (error) {
    logger.error("listMemberConsents error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/consent/status  { company_id, policy_type?='AUP', policy_version? }
// Compliance view: which students have / have NOT signed the policy.
const consentStatus = async (req, res) => {
  const connection = getConnection();
  const { company_id, policy_type, policy_version } = req.body || {};
  if (!company_id) {
    return res.status(400).json({ ok: false, msg: "company_id is required" });
  }
  const pType = policy_type && String(policy_type).trim() ? String(policy_type).trim() : "AUP";
  const values = [pType];
  let versionClause = "";
  if (policy_version && String(policy_version).trim() !== "") {
    versionClause = "AND sc.policy_version = ?";
    values.push(String(policy_version).trim());
  }
  values.push(company_id);
  try {
    const [rows] = await connection.query(
      `SELECT mi.member_id, mi.first_name, mi.last_name, mi.grade, mi.date_of_birth,
              (sc.id IS NOT NULL) AS consented
         FROM members_info mi
         LEFT JOIN school_consent sc
            ON sc.member_id = mi.member_id AND sc.company_id = mi.company_id
           AND sc.policy_type = ? ${versionClause} AND sc.status = 'agreed'
        WHERE mi.company_id = ?`,
      values
    );
    // A member may match multiple consent rows (versions); collapse to consented-if-any.
    const byMember = new Map();
    for (const r of rows) {
      const consented = Number(r.consented) === 1;
      const prev = byMember.get(r.member_id);
      if (!prev) byMember.set(r.member_id, { ...r, consented });
      else if (consented) prev.consented = true;
    }
    for (const [, member] of byMember) {
      member.under_13 = isUnder13(member.date_of_birth, new Date());
    }
    const members = [...byMember.values()];
    const summary = summarizeConsentStatus(members);
    return res.status(200).json({ ok: true, policy_type: pType, ...summary, members });
  } catch (error) {
    logger.error("consentStatus error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/settings  { company_id }  -> current school settings
// (consent enforcement etc.). Missing row => defaults (enforcement OFF).
const getSchoolSettings = async (req, res) => {
  const connection = getConnection();
  const { company_id } = req.body || {};
  if (!company_id) {
    return res.status(400).json({ ok: false, msg: "company_id is required" });
  }
  try {
    const [rows] = await connection.query(
      `SELECT enforce_member_consent, enforce_under_13_consent, required_consent_policy_version
         FROM company_school_settings WHERE company_id = ? LIMIT 1`,
      [company_id]
    );
    const enforce_member_consent = rows.length ? Number(rows[0].enforce_member_consent) === 1 : false;
    const enforce_under_13_consent = rows.length
      ? Number(rows[0].enforce_under_13_consent) === 1
      : false;
    const required_consent_policy_version = rows.length
      ? rows[0].required_consent_policy_version || null
      : null;
    return res.status(200).json({
      ok: true,
      settings: {
        enforce_member_consent,
        enforce_under_13_consent,
        required_consent_policy_version,
      },
    });
  } catch (error) {
    logger.error("getSchoolSettings error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/settings/consent-enforcement
// { company_id, enforce, enforce_under_13?, required_consent_policy_version? }
// Opt-in toggle. Upsert into the separate company_school_settings table (never
// touches company_info). Turn ON only AFTER backfilling consents, or existing
// minors without a recorded consent will be blocked from device assignment.
const setConsentEnforcement = async (req, res) => {
  const connection = getConnection();
  const { company_id, enforce, enforce_under_13, required_consent_policy_version } = req.body || {};
  if (!company_id) {
    return res.status(400).json({ ok: false, msg: "company_id is required" });
  }
  const val =
    enforce === true ||
    enforce === 1 ||
    String(enforce).toLowerCase() === "true" ||
    String(enforce) === "1"
      ? 1
      : 0;
  const under13Val =
    enforce_under_13 === true ||
    enforce_under_13 === 1 ||
    String(enforce_under_13).toLowerCase() === "true" ||
    String(enforce_under_13) === "1"
      ? 1
      : 0;
  const requiredVersion =
    required_consent_policy_version !== undefined &&
    required_consent_policy_version !== null &&
    String(required_consent_policy_version).trim() !== ""
      ? String(required_consent_policy_version).trim()
      : null;
  try {
    await connection.execute(
      `INSERT INTO company_school_settings
         (company_id, enforce_member_consent, enforce_under_13_consent, required_consent_policy_version)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enforce_member_consent = VALUES(enforce_member_consent),
         enforce_under_13_consent = VALUES(enforce_under_13_consent),
         required_consent_policy_version = VALUES(required_consent_policy_version)`,
      [company_id, val, under13Val, requiredVersion]
    );
    return res.status(200).json({
      ok: true,
      settings: {
        enforce_member_consent: val === 1,
        enforce_under_13_consent: under13Val === 1,
        required_consent_policy_version: requiredVersion,
      },
    });
  } catch (error) {
    logger.error("setConsentEnforcement error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  schoolDashboard,
  schoolRoster,
  listStudentGuardians,
  addStudentGuardian,
  recordConsent,
  requestConsent,
  publicRetrieveConsent,
  publicRespondConsent,
  listMemberConsents,
  consentStatus,
  getSchoolSettings,
  setConsentEnforcement,
  studentExport,
  studentErase,
  studentAccessLog,
  buildSchoolDashboard,
  classifyMemberLease,
  mergeGuardians,
  summarizeConsentStatus,
  validateStudentRequest,
  anonymizeStudent,
  deleteStudent,
};
