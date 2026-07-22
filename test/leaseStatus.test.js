'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// classifyLease is a pure helper (no DB); requiring the controller does not open
// a connection (getConnection is lazy), so this needs no config stub.
const { classifyLease } = require(path.resolve(__dirname, '../mysql/controllers/lease.js'));

const NOW = new Date('2026-07-21T12:00:00Z').getTime();

test('outstanding + past due date => overdue', () => {
  const c = classifyLease({ outstanding: 1, expected_return_date: '2026-07-01', return_status: null }, NOW);
  assert.equal(c.outstanding, true);
  assert.equal(c.overdue, true);
  assert.equal(c.status, 'overdue');
});

test('outstanding + future due date => outstanding, not overdue', () => {
  const c = classifyLease({ outstanding: 1, expected_return_date: '2026-08-01', return_status: null }, NOW);
  assert.equal(c.overdue, false);
  assert.equal(c.status, 'outstanding');
});

test('not outstanding => returned', () => {
  const c = classifyLease({ outstanding: 0, expected_return_date: '2026-07-01', return_status: null }, NOW);
  assert.equal(c.overdue, false);
  assert.equal(c.status, 'returned');
});

test('lost end-state wins over returned', () => {
  const c = classifyLease({ outstanding: 0, expected_return_date: '2026-07-01', return_status: 'lost' }, NOW);
  assert.equal(c.status, 'lost');
});

test('damaged end-state wins even with null due date', () => {
  const c = classifyLease({ outstanding: 0, expected_return_date: null, return_status: 'damaged' }, NOW);
  assert.equal(c.status, 'damaged');
});

test('null or blank due date on an outstanding lease is not overdue', () => {
  const c1 = classifyLease({ outstanding: 1, expected_return_date: null, return_status: null }, NOW);
  assert.equal(c1.overdue, false);
  assert.equal(c1.status, 'outstanding');
  const c2 = classifyLease({ outstanding: 1, expected_return_date: '', return_status: null }, NOW);
  assert.equal(c2.overdue, false);
  assert.equal(c2.status, 'outstanding');
});

test('invalid date string is not overdue (safe, no false positive)', () => {
  const c = classifyLease({ outstanding: 1, expected_return_date: 'not-a-date', return_status: null }, NOW);
  assert.equal(c.overdue, false);
  assert.equal(c.status, 'outstanding');
});

test('outstanding "outstanding" flag comes from the numeric view column (0/1)', () => {
  // the view emits outstanding as 0/1 (bigint); ensure Number() coercion holds
  assert.equal(classifyLease({ outstanding: 1, expected_return_date: null }, NOW).outstanding, true);
  assert.equal(classifyLease({ outstanding: 0, expected_return_date: null }, NOW).outstanding, false);
});
