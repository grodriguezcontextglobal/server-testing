'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { calculateAge, isUnder13 } = require(path.resolve(__dirname, '../mysql/helpers/ageCalc.js'));

const NOW = new Date('2026-07-23T12:00:00Z');

test('calculateAge returns 2 for DOB two years ago', () => {
  assert.equal(calculateAge('2024-07-23', NOW), 2);
});

test('calculateAge returns 13 for DOB exactly 13 years ago today', () => {
  assert.equal(calculateAge('2013-07-23', NOW), 13);
});

test('calculateAge returns 13 for DOB 13 years ago yesterday', () => {
  assert.equal(calculateAge('2013-07-22', NOW), 13);
});

test('calculateAge returns 12 when the thirteenth birthday is tomorrow', () => {
  assert.equal(calculateAge('2013-07-24', NOW), 12);
});

test('calculateAge returns null for null or invalid DOB', () => {
  assert.equal(calculateAge(null, NOW), null);
  assert.equal(calculateAge('not-a-date', NOW), null);
});

test('isUnder13 maps DOB to COPPA status', () => {
  assert.equal(isUnder13('2016-07-23', NOW), true);
  assert.equal(isUnder13('2013-07-23', NOW), false);
  assert.equal(isUnder13(null, NOW), null);
});
