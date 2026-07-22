'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { minorsMissingConsent } = require(path.resolve(__dirname, '../mysql/helpers/consentGate.js'));

const rows = [
  { member_id: 1, first_name: 'A', minor: 1 }, // minor, no consent -> blocked
  { member_id: 2, first_name: 'B', minor: 1 }, // minor, has consent -> ok
  { member_id: 3, first_name: 'C', minor: 0 }, // adult -> never blocked
];

test('returns minors without a recorded consent', () => {
  const missing = minorsMissingConsent(rows, new Set([2]));
  assert.deepEqual(missing.map((m) => m.member_id), [1]);
});

test('adults are never blocked even without consent', () => {
  const missing = minorsMissingConsent(rows, new Set());
  assert.deepEqual(missing.map((m) => m.member_id), [1, 2]); // only the two minors
  assert.equal(missing.some((m) => m.member_id === 3), false);
});

test('all minors consented => none missing', () => {
  assert.deepEqual(minorsMissingConsent(rows, new Set([1, 2])), []);
});

test('accepts an array of consented ids (not just a Set)', () => {
  const missing = minorsMissingConsent(rows, [2]);
  assert.deepEqual(missing.map((m) => m.member_id), [1]);
});

test('empty inputs => empty', () => {
  assert.deepEqual(minorsMissingConsent([], new Set()), []);
  assert.deepEqual(minorsMissingConsent(undefined, undefined), []);
});
