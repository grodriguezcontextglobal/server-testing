'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateOtc,
  otcExpiresAt,
  isOtcExpired,
  isConsentMutable,
  isValidDecision,
} = require('../mysql/helpers/consentOtc');

test('generateOtc returns a non-empty URL-safe string', () => {
  const otc = generateOtc();
  assert.equal(typeof otc, 'string');
  assert.ok(otc.length > 0);
  assert.match(otc, /^[A-Za-z0-9_-]+$/);
});

test('otcExpiresAt returns a date 7 days from now', () => {
  const now = new Date('2026-07-23T12:00:00.000Z');
  const expires = otcExpiresAt(now);
  assert.equal(expires.toISOString(), '2026-07-30T12:00:00.000Z');
});

test('isOtcExpired returns false for a future date', () => {
  assert.equal(
    isOtcExpired('2026-07-24T12:00:00.000Z', new Date('2026-07-23T12:00:00.000Z')),
    false
  );
});

test('isOtcExpired returns true for a past date', () => {
  assert.equal(
    isOtcExpired('2026-07-22T12:00:00.000Z', new Date('2026-07-23T12:00:00.000Z')),
    true
  );
});

test('isConsentMutable returns true only for pending', () => {
  assert.equal(isConsentMutable('pending'), true);
  assert.equal(isConsentMutable('agreed'), false);
});

test('isValidDecision accepts agreed and refused only', () => {
  assert.equal(isValidDecision('agreed'), true);
  assert.equal(isValidDecision('refused'), true);
  assert.equal(isValidDecision('invalid'), false);
});
