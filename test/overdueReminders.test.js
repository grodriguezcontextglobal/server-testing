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
const crypto = require('node:crypto');
const tag = (email) => crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);

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

test('job shape: type, from, recipient, subject, and per-recipient per-day idempotencyKey', () => {
  const { jobs } = buildReminderJobs([baseRow], { now: NOW });
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.type, 'send-email');
  assert.equal(j.payload.to, 'anne@guardian.example');
  assert.equal(j.payload.from, 'Devitrak Notifications <noreply@devitrak.com>');
  assert.match(j.payload.subject, /Overdue device reminder — Ada Lovelace/);
  // El correo no va en claro en la clave: se indexa y se ve en cualquier listado de jobs.
  assert.equal(j.idempotencyKey, `overdue-reminder:61:to-${tag('anne@guardian.example')}:2026-07-22`);
  assert.ok(!j.idempotencyKey.includes('@'));
  assert.deepEqual(j.context, { companyId: '61' });
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
  // 5001 y 5002 comparten tutor en la misma compañía: el día 3 de 5001 dispara
  // un correo que lleva también el 5002 (en descanso, día 20) — ya no "resting".
  assert.deepEqual(result, { overdue: 3, queued: 1, devices: 2, skipped: 1, resting: 0 });
  assert.deepEqual(enqueued, [`overdue-reminder:61:to-${tag('anne@guardian.example')}:2026-07-22`]);
});

// --- Un correo por destinatario y día (opción 1, 2026-10-12) -----------------

const sibling = {
  ...baseRow,
  member_id: 5002,
  device_id: 9002,
  first_name: 'Alan',
  last_name: 'Turing',
  device_serial_number: 'SN-456',
};

test('grouping: two siblings due the same day with the same guardian => ONE email listing both', () => {
  const { jobs } = buildReminderJobs([baseRow, { ...sibling, days_overdue: 5 }], { now: NOW });
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.payload.to, 'anne@guardian.example');
  assert.match(j.payload.subject, /2 devices: Ada Lovelace, Alan Turing/);
  assert.match(j.payload.html, /SN-123/);
  assert.match(j.payload.html, /SN-456/);
  assert.match(j.payload.html, /Dear Anne/);
  assert.deepEqual(j.leases.map((l) => l.device_id), [9001, 9002]); // más atrasado primero
});

test('grouping: a lease on its rest day rides along when a sibling lease is due', () => {
  const { jobs } = buildReminderJobs([{ ...baseRow, days_overdue: 18 }, { ...sibling, days_overdue: 17 }], { now: NOW });
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].leases.map((l) => l.device_id), [9001, 9002]);
});

test('grouping: when no lease of the recipient is due, nothing is sent', () => {
  const { jobs, skipped } = buildReminderJobs([{ ...baseRow, days_overdue: 18 }, { ...sibling, days_overdue: 19 }], { now: NOW });
  assert.equal(jobs.length, 0);
  assert.equal(skipped.length, 0);
});

test('grouping: never across companies — same guardian in two schools gets one email per school', () => {
  const { jobs } = buildReminderJobs([baseRow, { ...sibling, company_id: 62 }], { now: NOW });
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map((j) => j.context.companyId).sort(), ['61', '62']);
  for (const j of jobs) assert.equal(j.leases.length, 1);
});

test('grouping: recipient match ignores email case', () => {
  const { jobs } = buildReminderJobs(
    [baseRow, { ...sibling, parent_guardian_email: 'Anne@Guardian.Example' }],
    { now: NOW }
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].leases.length, 2);
});

test('grouping: different guardians in the same school stay separate emails', () => {
  const { jobs } = buildReminderJobs([baseRow, { ...sibling, parent_guardian_email: 'other@guardian.example' }], { now: NOW });
  assert.equal(jobs.length, 2);
});

test('single-device email keeps the original layout (no multi-device table)', () => {
  const { jobs } = buildReminderJobs([baseRow], { now: NOW });
  assert.doesNotMatch(jobs[0].payload.html, /<thead>/);
  assert.match(jobs[0].payload.html, /12 day\(s\) overdue/);
});
