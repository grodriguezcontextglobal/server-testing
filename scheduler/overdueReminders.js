'use strict';

/**
 * Overdue-device reminder producer (school track).
 *
 * Finds outstanding member device leases past their expected return date and
 * enqueues a `send-email` job per lease (SendGrid msg built here, the network
 * call is deferred to the queue worker — see queue/handlers/email.js).
 *
 * buildReminderJobs is PURE and exported for unit tests; runOverdueReminders
 * wires it to the DB + queue with injectable deps.
 *
 * Dedup: one reminder per lease per calendar day via idempotencyKey, so a re-run
 * (retry, multiple cluster instances) never double-sends.
 */
const getConnection = require("../mysql/database/config");
const { enqueue } = require("../helpers/queue");
const logger = require("../helpers/logger");
const { overdueReminderMessageHtml } = require("../nodeMailer/overdueReminderMessage");

const FROM = "Devitrak Notifications <noreply@devitrak.com>";

// NOTE: member_assigned_device_lease has NO lease_id column and stores dates as
// VARCHAR, so we key by the (company_id, member_id, device_id) composite and CAST
// the date for the comparison. (The existing retrieveOverdueLeases selects a
// non-existent madl.lease_id — do not copy that.)
const OVERDUE_QUERY = `
  SELECT
    madl.company_id, madl.member_id, madl.device_id,
    madl.expected_return_date, madl.location,
    DATEDIFF(NOW(), CAST(madl.expected_return_date AS DATETIME)) AS days_overdue,
    mi.first_name, mi.last_name, mi.email, mi.grade, mi.homeroom,
    mi.minor, mi.parent_guardian_first_name, mi.parent_guardian_last_name, mi.parent_guardian_email,
    ii.serial_number AS device_serial_number, ii.category_name AS device_category_name, ii.brand AS device_brand
  FROM member_assigned_device_lease madl
  JOIN members_info mi ON mi.member_id = madl.member_id AND mi.company_id = madl.company_id
  LEFT JOIN item_inv ii ON ii.item_id = madl.device_id
  WHERE madl.returned = 0
    AND madl.expected_return_date IS NOT NULL AND madl.expected_return_date <> ''
    AND CAST(madl.expected_return_date AS DATETIME) < NOW()
  ORDER BY madl.company_id, madl.expected_return_date ASC`;

// Minors → guardian; otherwise the member. Fall back to whichever email exists.
const pickRecipient = (row) => {
  const guardian = row.parent_guardian_email && String(row.parent_guardian_email).trim();
  const member = row.email && String(row.email).trim();
  if (Number(row.minor) === 1 && guardian) return { email: guardian, toGuardian: true };
  if (member) return { email: member, toGuardian: false };
  if (guardian) return { email: guardian, toGuardian: true };
  return null;
};

// YYYY-MM-DD (UTC) — stable per calendar day for idempotency.
const dayStamp = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * PURE: overdue rows -> { jobs, skipped }. Deterministic given `now`.
 * Each job is { type, payload:{to,from,subject,html}, idempotencyKey }.
 */
const buildReminderJobs = (rows = [], { now = Date.now() } = {}) => {
  const stamp = dayStamp(now);
  const jobs = [];
  const skipped = [];
  for (const row of rows) {
    const recipient = pickRecipient(row);
    if (!recipient) {
      skipped.push({
        company_id: row.company_id,
        member_id: row.member_id,
        device_id: row.device_id,
        reason: "no-email",
      });
      continue;
    }
    const studentName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
    jobs.push({
      type: "send-email",
      payload: {
        to: recipient.email,
        from: FROM,
        subject: `Overdue device reminder${studentName ? ` — ${studentName}` : ""}`,
        html: overdueReminderMessageHtml({ ...row, toGuardian: recipient.toGuardian }),
      },
      idempotencyKey: `overdue-reminder:${row.company_id}:${row.member_id}:${row.device_id}:${stamp}`,
    });
  }
  return { jobs, skipped };
};

/**
 * Query overdue leases and enqueue a reminder per lease. Deps are injectable so
 * the wiring can be exercised without a real DB/queue in tests.
 */
const runOverdueReminders = async ({
  getConnection: getConn = getConnection,
  enqueue: enq = enqueue,
  now = Date.now(),
} = {}) => {
  const cn = getConn();
  const [rows] = await cn.query(OVERDUE_QUERY);
  const { jobs, skipped } = buildReminderJobs(rows, { now });
  let queued = 0;
  for (const job of jobs) {
    try {
      await enq(job.type, job.payload, { idempotencyKey: job.idempotencyKey });
      // FERPA disclosure audit follow-up: reminder emails disclose education-record
      // data externally, but StaffActivityLog.staff_member_id currently requires a
      // valid AdminUser ObjectId. Add a system actor or schema-supported nullable
      // service account before logging these scheduler-originated disclosures.
      queued++;
    } catch (e) {
      logger.error(`overdue reminder enqueue failed (${job.idempotencyKey}): ${e.message}`);
    }
  }
  logger.info(
    `overdue reminders: ${rows.length} overdue → ${queued} queued, ${skipped.length} skipped (no email)`
  );
  return { overdue: rows.length, queued, skipped: skipped.length };
};

module.exports = { buildReminderJobs, runOverdueReminders, pickRecipient, OVERDUE_QUERY, FROM };
