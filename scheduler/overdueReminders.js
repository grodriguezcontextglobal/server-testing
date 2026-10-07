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
 *
 * Cadencia (isReminderDay): diario las 2 primeras semanas de atraso, luego se
 * espacia (+3, +5, +7 dias) y queda semanal hasta que el lease se devuelve o el
 * staff los detiene desde el dashboard (reminders_stopped_at).
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
    AND madl.reminders_stopped_at IS NULL
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

// Dias de atraso (DATEDIFF de calendario; el dia del vencimiento es 0) en los
// que toca recordatorio: diario hasta el 14, luego 17 (+3), 22 (+5), 29 (+7) y
// de ahi cada 7. Es funcion del atraso y no del ultimo envio, asi que no hace
// falta guardar estado; el costo es que si el cron no corre un dia que tocaba
// (servidor caido), ese recordatorio se pierde y sale el siguiente de la serie.
const DAILY_UNTIL_DAY = 14;
const SPACED_DAYS = [17, 22, 29];
const WEEKLY_FROM_DAY = 29;

const isReminderDay = (daysOverdue) => {
  // Number(null) y Number("") son 0: sin este corte un atraso nulo pasaria por dia 0.
  if (daysOverdue === null || daysOverdue === undefined || daysOverdue === "") return false;
  const d = Number(daysOverdue);
  if (!Number.isInteger(d) || d < 0) return false;
  if (d <= DAILY_UNTIL_DAY) return true;
  if (SPACED_DAYS.includes(d)) return true;
  return d > WEEKLY_FROM_DAY && (d - WEEKLY_FROM_DAY) % 7 === 0;
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
    if (!isReminderDay(row.days_overdue)) continue;
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
  const resting = rows.length - jobs.length - skipped.length;
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
    `overdue reminders: ${rows.length} overdue → ${queued} queued, ${skipped.length} skipped (no email), ${resting} not due today`
  );
  return { overdue: rows.length, queued, skipped: skipped.length, resting };
};

module.exports = { buildReminderJobs, runOverdueReminders, pickRecipient, isReminderDay, OVERDUE_QUERY, FROM };
