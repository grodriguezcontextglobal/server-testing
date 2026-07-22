require("dotenv").config();
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

module.exports = { schoolDashboard, buildSchoolDashboard, classifyMemberLease };
