'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Both requires are lazy re: DB (getConnection connects on first call), so no stub needed.
const { industryMatches } = require(path.resolve(__dirname, '../middlewares/requireIndustry.js'));
const { buildSchoolDashboard, mergeGuardians } = require(path.resolve(__dirname, '../mysql/controllers/school.js'));

const NOW = new Date('2026-07-22T12:00:00Z').getTime();

// ── industryMatches ──────────────────────────────────────────────────────────
test('industryMatches is case-insensitive and trims', () => {
  assert.equal(industryMatches('Education', ['Education']), true);
  assert.equal(industryMatches('  education ', ['Education']), true);
  assert.equal(industryMatches('EDUCATION', ['education']), true);
});

test('industryMatches rejects other industries and empty', () => {
  assert.equal(industryMatches('Retail', ['Education']), false);
  assert.equal(industryMatches('', ['Education']), false);
  assert.equal(industryMatches(null, ['Education']), false);
  assert.equal(industryMatches('Education', []), false);
});

// ── buildSchoolDashboard ─────────────────────────────────────────────────────
const rows = [
  { member_id: 1, returned: 0, return_status: null, expected_return_date: '2026-07-01', grade: '5' }, // overdue
  { member_id: 1, returned: 0, return_status: null, expected_return_date: '2026-08-01', grade: '5' }, // outstanding
  { member_id: 2, returned: 1, return_status: null, expected_return_date: '2026-06-01', grade: '6' }, // returned
  { member_id: 3, returned: 1, return_status: 'lost', expected_return_date: '2026-06-01', grade: '6' }, // lost
  { member_id: 4, returned: 1, return_status: 'damaged', expected_return_date: null, grade: '' },       // damaged, unassigned grade
];

test('dashboard summary counts by status', () => {
  const { summary } = buildSchoolDashboard(rows, { now: NOW });
  assert.equal(summary.total_leases, 5);
  assert.equal(summary.outstanding, 2);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.returned, 1);
  assert.equal(summary.lost, 1);
  assert.equal(summary.damaged, 1);
  assert.equal(summary.students_with_devices, 4); // distinct member_id
});

test('dashboard breaks down by grade, blank grade => Unassigned', () => {
  const { by_grade } = buildSchoolDashboard(rows, { now: NOW });
  assert.deepEqual(by_grade['5'], { total: 2, outstanding: 2, overdue: 1 });
  assert.deepEqual(by_grade['6'], { total: 2, outstanding: 0, overdue: 0 });
  assert.equal(by_grade['Unassigned'].total, 1);
});

test('empty input => zeroed summary, empty grades', () => {
  const { summary, by_grade } = buildSchoolDashboard([], { now: NOW });
  assert.equal(summary.total_leases, 0);
  assert.equal(summary.students_with_devices, 0);
  assert.deepEqual(by_grade, {});
});

// ── mergeGuardians ───────────────────────────────────────────────────────────
const norm = [
  { id: 'g1', first_name: 'Bob', last_name: 'Smith', email: 'bob@x.com', phone_number: '111', relationship: 'father', is_primary: 0 },
];
const embedded = {
  parent_guardian_first_name: 'Anne',
  parent_guardian_last_name: 'Smith',
  parent_guardian_email: 'anne@x.com',
  parent_guardian_phone_number: '222',
};

test('mergeGuardians prepends the embedded primary guardian', () => {
  const list = mergeGuardians(norm, embedded);
  assert.equal(list.length, 2);
  assert.equal(list[0].source, 'embedded');
  assert.equal(list[0].email, 'anne@x.com');
  assert.equal(list[0].is_primary, true);
  assert.equal(list[1].source, 'normalized');
  assert.equal(list[1].email, 'bob@x.com');
});

test('mergeGuardians dedupes the embedded guardian by email (case-insensitive)', () => {
  const list = mergeGuardians(
    [{ id: 'g2', first_name: 'Anne', last_name: 'Smith', email: 'ANNE@x.com', phone_number: '222', relationship: null, is_primary: 1 }],
    embedded
  );
  assert.equal(list.length, 1); // embedded not added, already present normalized
  assert.equal(list[0].source, 'normalized');
});

test('mergeGuardians with no embedded guardian returns only normalized', () => {
  assert.equal(mergeGuardians(norm, null).length, 1);
  assert.equal(mergeGuardians(norm, {}).length, 1);
});

test('mergeGuardians with nothing => empty list', () => {
  assert.deepEqual(mergeGuardians([], null), []);
});
