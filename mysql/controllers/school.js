require("dotenv").config();
const { randomUUID } = require("crypto");
const logger = require("../../helpers/logger");
const getConnection = require("../database/config");

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
      missing.push({
        member_id: r.member_id,
        first_name: r.first_name,
        last_name: r.last_name,
        grade: r.grade || null,
      });
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
           (id, company_id, member_id, guardian_id, policy_type, policy_version, signer_name, signer_email, method, consented_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
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

// POST /api/school/consent  { company_id, member_id }  -> consents for a student
const listMemberConsents = async (req, res) => {
  const connection = getConnection();
  const { company_id, member_id } = req.body || {};
  if (!company_id || member_id === undefined || member_id === null || String(member_id).trim() === "") {
    return res.status(400).json({ ok: false, msg: "company_id and member_id are required" });
  }
  try {
    const [rows] = await connection.query(
      `SELECT id, guardian_id, policy_type, policy_version, signer_name, signer_email, method, consented_at
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
      `SELECT mi.member_id, mi.first_name, mi.last_name, mi.grade,
              (sc.id IS NOT NULL) AS consented
         FROM members_info mi
         LEFT JOIN school_consent sc
           ON sc.member_id = mi.member_id AND sc.company_id = mi.company_id
          AND sc.policy_type = ? ${versionClause}
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
    const summary = summarizeConsentStatus([...byMember.values()]);
    return res.status(200).json({ ok: true, policy_type: pType, ...summary });
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
      "SELECT enforce_member_consent FROM company_school_settings WHERE company_id = ? LIMIT 1",
      [company_id]
    );
    const enforce_member_consent = rows.length ? Number(rows[0].enforce_member_consent) === 1 : false;
    return res.status(200).json({ ok: true, settings: { enforce_member_consent } });
  } catch (error) {
    logger.error("getSchoolSettings error:", error.message);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

// POST /api/school/settings/consent-enforcement  { company_id, enforce }
// Opt-in toggle. Upsert into the separate company_school_settings table (never
// touches company_info). Turn ON only AFTER backfilling consents, or existing
// minors without a recorded consent will be blocked from device assignment.
const setConsentEnforcement = async (req, res) => {
  const connection = getConnection();
  const { company_id, enforce } = req.body || {};
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
  try {
    await connection.execute(
      `INSERT INTO company_school_settings (company_id, enforce_member_consent)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE enforce_member_consent = VALUES(enforce_member_consent)`,
      [company_id, val]
    );
    return res.status(200).json({ ok: true, settings: { enforce_member_consent: val === 1 } });
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
  listMemberConsents,
  consentStatus,
  getSchoolSettings,
  setConsentEnforcement,
  buildSchoolDashboard,
  classifyMemberLease,
  mergeGuardians,
  summarizeConsentStatus,
};
