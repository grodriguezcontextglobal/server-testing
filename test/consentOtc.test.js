'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateOtc,
  hashOtc,
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

test('hashOtc is a stable 64-char hex digest', () => {
  const digest = hashOtc('some-token');
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, hashOtc('some-token'));
});

test('hashOtc separates distinct codes', () => {
  assert.notEqual(hashOtc(generateOtc()), hashOtc(generateOtc()));
});

test('hashOtc never returns the code it was given', () => {
  // The stored value must not be usable as a consent link on its own.
  const otc = generateOtc();
  assert.notEqual(hashOtc(otc), otc);
  assert.ok(!hashOtc(otc).includes(otc));
});

test('hashOtc matches MySQL SHA2(otc, 256) so the backfill lines up', () => {
  // Fixed vector: `SELECT SHA2('abc', 256)` in MySQL returns this digest. The
  // otc_hash migration backfills with SHA2(), so a drift here would silently
  // invalidate every consent link issued before the migration ran.
  assert.equal(
    hashOtc('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});
