/**
 * date_of_birth persistence on members_info.
 *
 * The column was missing from every allowlist in mysql/controllers/members.js,
 * so the New Member form posted a birthdate, the API quietly dropped it, and
 * nothing reported a problem. Every member ended up with no DOB, which in turn
 * meant anything deriving age from it (the minor check that gates the guardian
 * editor, the under-13 COPPA branch) silently read every student as an adult.
 *
 * These cover the normalizer that now guards the three write paths: single
 * insert, bulk import, and update.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { normalizeDateOfBirth } = require('../mysql/controllers/members');

test('leaves the column alone when nothing was supplied', () => {
  assert.strictEqual(normalizeDateOfBirth(undefined), undefined);
});

test('treats empty values as an explicit clear', () => {
  assert.strictEqual(normalizeDateOfBirth(null), null);
  assert.strictEqual(normalizeDateOfBirth(''), null);
  assert.strictEqual(normalizeDateOfBirth('   '), null);
});

test('accepts a plain YYYY-MM-DD date', () => {
  assert.strictEqual(normalizeDateOfBirth('2010-11-21'), '2010-11-21');
});

test('accepts a full ISO timestamp and keeps only the date part', () => {
  assert.strictEqual(
    normalizeDateOfBirth('2010-11-21T05:00:00.000Z'),
    '2010-11-21'
  );
});

test('trims surrounding whitespace', () => {
  assert.strictEqual(normalizeDateOfBirth('  2010-11-21  '), '2010-11-21');
});

test('rejects values that are not dates', () => {
  assert.strictEqual(normalizeDateOfBirth('not a date'), false);
  assert.strictEqual(normalizeDateOfBirth('11/21/2010'), false);
  assert.strictEqual(normalizeDateOfBirth('2010-11'), false);
  assert.strictEqual(normalizeDateOfBirth(20101121), false);
});

test('rejects impossible calendar dates instead of rolling them over', () => {
  // new Date(2026, 1, 31) silently becomes March 3rd; that must not persist.
  assert.strictEqual(normalizeDateOfBirth('2026-02-31'), false);
  assert.strictEqual(normalizeDateOfBirth('2010-13-01'), false);
  assert.strictEqual(normalizeDateOfBirth('2010-00-10'), false);
});

test('accepts a real leap day', () => {
  assert.strictEqual(normalizeDateOfBirth('2012-02-29'), '2012-02-29');
});

test('rejects a leap day in a non-leap year', () => {
  assert.strictEqual(normalizeDateOfBirth('2011-02-29'), false);
});

test('rejects a birthdate in the future', () => {
  const nextYear = new Date();
  nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
  assert.strictEqual(
    normalizeDateOfBirth(nextYear.toISOString().slice(0, 10)),
    false
  );
});

test('accepts a birthdate from today', () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.strictEqual(normalizeDateOfBirth(today), today);
});
