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
