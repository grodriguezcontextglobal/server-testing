'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// buildReminderJobs is pure; requiring the module opens no DB/Mongo connection
// (getConnection + the queue helper are lazy), so no stubs are needed here.
const { buildReminderJobs, pickRecipient } = require(
  path.resolve(__dirname, '../scheduler/overdueReminders.js')
);

const NOW = new Date('2026-07-22T09:00:00Z').getTime();

const baseRow = {
  company_id: 61,
  member_id: 5001,
  device_id: 9001,
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@student.example',
  minor: 1,
  parent_guardian_first_name: 'Anne',
  parent_guardian_email: 'anne@guardian.example',
  grade: '5',
  homeroom: 'A',
  expected_return_date: '2026-07-10',
  days_overdue: 12,
  device_brand: 'Apple',
  device_category_name: 'iPad',
  device_serial_number: 'SN-123',
};

test('minor with a guardian email => email goes to the guardian', () => {
  const r = pickRecipient(baseRow);
  assert.equal(r.email, 'anne@guardian.example');
  assert.equal(r.toGuardian, true);
});

test('non-minor => email goes to the member', () => {
  const r = pickRecipient({ ...baseRow, minor: 0 });
  assert.equal(r.email, 'ada@student.example');
  assert.equal(r.toGuardian, false);
});

test('minor without a guardian email falls back to the member email', () => {
  const r = pickRecipient({ ...baseRow, parent_guardian_email: '' });
  assert.equal(r.email, 'ada@student.example');
  assert.equal(r.toGuardian, false);
});

test('no usable email => skipped, no job', () => {
  const { jobs, skipped } = buildReminderJobs(
    [{ ...baseRow, minor: 0, email: '', parent_guardian_email: null }],
    { now: NOW }
  );
  assert.equal(jobs.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'no-email');
});

test('job shape: type, from, recipient, subject, and per-day idempotencyKey', () => {
  const { jobs } = buildReminderJobs([baseRow], { now: NOW });
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.type, 'send-email');
  assert.equal(j.payload.to, 'anne@guardian.example');
  assert.equal(j.payload.from, 'Devitrak Notifications <noreply@devitrak.com>');
  assert.match(j.payload.subject, /Overdue device reminder — Ada Lovelace/);
  assert.equal(j.idempotencyKey, 'overdue-reminder:61:5001:9001:2026-07-22');
  assert.match(j.payload.html, /Overdue device reminder/);
});

test('idempotencyKey stamp changes with the day (dedupe is per calendar day)', () => {
  const day1 = buildReminderJobs([baseRow], { now: NOW }).jobs[0].idempotencyKey;
  const day2 = buildReminderJobs([baseRow], { now: NOW + 24 * 60 * 60 * 1000 }).jobs[0].idempotencyKey;
  assert.notEqual(day1, day2);
  assert.ok(day1.endsWith('2026-07-22'));
  assert.ok(day2.endsWith('2026-07-23'));
});

test('guardian email addresses the guardian by first name in the HTML', () => {
  const { jobs } = buildReminderJobs([baseRow], { now: NOW });
  assert.match(jobs[0].payload.html, /Dear Anne/);
});

test('empty input => no jobs, no skips', () => {
  const { jobs, skipped } = buildReminderJobs([], { now: NOW });
  assert.equal(jobs.length, 0);
  assert.equal(skipped.length, 0);
});

// --- Cadencia: diario 2 semanas, luego +3, +5, +7 y semanal ---------------
const { isReminderDay, runOverdueReminders, OVERDUE_QUERY } = require(
  path.resolve(__dirname, '../scheduler/overdueReminders.js')
);

test('cadence: sends every day of the first two weeks (days 0..14)', () => {
  for (let d = 0; d <= 14; d++) assert.equal(isReminderDay(d), true, `day ${d}`);
});

test('cadence: after day 14 the series is 17, 22, 29, then every 7 days', () => {
  const sent = [];
  for (let d = 15; d <= 60; d++) if (isReminderDay(d)) sent.push(d);
  assert.deepEqual(sent, [17, 22, 29, 36, 43, 50, 57]);
});

test('cadence: invalid or negative days never send', () => {
  for (const d of [-1, null, undefined, '', 'x', 1.5]) assert.equal(isReminderDay(d), false, String(d));
  assert.equal(isReminderDay('17'), true); // mysql2 puede devolver el DATEDIFF como string
});

test('buildReminderJobs: a lease on a rest day produces neither a job nor a skip', () => {
  const { jobs, skipped } = buildReminderJobs([{ ...baseRow, days_overdue: 18 }], { now: NOW });
  assert.equal(jobs.length, 0);
  assert.equal(skipped.length, 0);
});

test('OVERDUE_QUERY excludes leases whose reminders were stopped from the dashboard', () => {
  assert.match(OVERDUE_QUERY, /reminders_stopped_at IS NULL/);
});

test('runOverdueReminders reports resting leases separately from skipped ones', async () => {
  const rows = [
    { ...baseRow, days_overdue: 3 },
    { ...baseRow, member_id: 5002, days_overdue: 20 },
    { ...baseRow, member_id: 5003, days_overdue: 36, minor: 0, email: '', parent_guardian_email: '' },
  ];
  const enqueued = [];
  const result = await runOverdueReminders({
    getConnection: () => ({ query: async () => [rows] }),
    enqueue: async (type, payload, opts) => enqueued.push(opts.idempotencyKey),
    now: NOW,
  });
  assert.deepEqual(result, { overdue: 3, queued: 1, skipped: 1, resting: 1 });
  assert.deepEqual(enqueued, ['overdue-reminder:61:5001:9001:2026-07-22']);
});
