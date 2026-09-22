'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { minorsMissingConsent, isConsentStale } = require(path.resolve(__dirname, '../mysql/helpers/consentGate.js'));

const NOW = new Date('2026-07-23T12:00:00Z');

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

test('under-13 member with DOB but no consent is blocked', () => {
  const missing = minorsMissingConsent(
    [{ member_id: 10, first_name: 'Kid', minor: 0, date_of_birth: '2016-07-23' }],
    new Set(),
    NOW
  );
  assert.deepEqual(missing.map((m) => m.member_id), [10]);
});

test('under-13 member with DOB and consent is not blocked', () => {
  const missing = minorsMissingConsent(
    [{ member_id: 10, first_name: 'Kid', minor: 0, date_of_birth: '2016-07-23' }],
    new Set([10]),
    NOW
  );
  assert.deepEqual(missing, []);
});

test('13+ member without consent is not blocked by COPPA DOB', () => {
  const missing = minorsMissingConsent(
    [{ member_id: 11, first_name: 'Teen', minor: 0, date_of_birth: '2013-07-23' }],
    new Set(),
    NOW
  );
  assert.deepEqual(missing, []);
});

test('invalid DOB with minor=0 is not blocked', () => {
  const missing = minorsMissingConsent(
    [{ member_id: 12, first_name: 'Unknown', minor: 0, date_of_birth: 'not-a-date' }],
    new Set(),
    NOW
  );
  assert.deepEqual(missing, []);
});

test('isConsentStale compares required policy version', () => {
  assert.equal(isConsentStale('2', '2'), false);
  assert.equal(isConsentStale('1', '2'), true);
  assert.equal(isConsentStale('1', null), false);
});
