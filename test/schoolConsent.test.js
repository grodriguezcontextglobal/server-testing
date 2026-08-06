/**
 * Guardian consent lifecycle — pure logic.
 *
 * The consent flow hands a guardian a one-time code by email and accepts a
 * decision back from an unauthenticated page, so the parts worth pinning down
 * without a database are: the code is unguessable and only ever stored hashed,
 * expiry is derived rather than swept, and a request stops being answerable
 * the moment it is answered or expires.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  generateOtc,
  hashOtc,
  normalizeEmail,
  buildConsentLink,
  deriveConsentStatus,
  isMutable,
  isPolicyStale,
} = require('../mysql/controllers/school');

const NOW = new Date('2026-08-05T12:00:00Z');
const past = new Date('2026-08-01T12:00:00Z');
const future = new Date('2026-08-20T12:00:00Z');

test('generateOtc produces a long, unique, url-safe code', () => {
  const a = generateOtc();
  const b = generateOtc();
  assert.notStrictEqual(a, b);
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.strictEqual(encodeURIComponent(a), a);
});

test('hashOtc is stable and does not leak the code', () => {
  const otc = generateOtc();
  const hash = hashOtc(otc);
  assert.strictEqual(hash, hashOtc(otc));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(otc));
});

test('hashOtc separates different codes', () => {
  assert.notStrictEqual(hashOtc('aaa'), hashOtc('aab'));
});

test('buildConsentLink points at the guardian response page', () => {
  const link = buildConsentLink('abc123', 'https://demo.example.com/');
  assert.strictEqual(
    link,
    'https://demo.example.com/school/consent/respond?otc=abc123'
  );
});

test('buildConsentLink tolerates a base url without a trailing slash', () => {
  assert.strictEqual(
    buildConsentLink('xyz', 'https://demo.example.com'),
    'https://demo.example.com/school/consent/respond?otc=xyz'
  );
});

test('normalizeEmail lowercases and trims', () => {
  assert.strictEqual(normalizeEmail('  Jane.Doe@Example.COM '), 'jane.doe@example.com');
  assert.strictEqual(normalizeEmail(null), '');
  assert.strictEqual(normalizeEmail(undefined), '');
});

test('deriveConsentStatus reports missing when there is no row', () => {
  assert.strictEqual(deriveConsentStatus(null, NOW), 'missing');
  assert.strictEqual(deriveConsentStatus(undefined, NOW), 'missing');
});

test('deriveConsentStatus keeps a decision that was already recorded', () => {
  assert.strictEqual(
    deriveConsentStatus({ status: 'agreed', expires_at: past }, NOW),
    'agreed'
  );
  assert.strictEqual(
    deriveConsentStatus({ status: 'refused', expires_at: past }, NOW),
    'refused'
  );
});

test('deriveConsentStatus expires a pending request whose window has closed', () => {
  assert.strictEqual(
    deriveConsentStatus({ status: 'pending', expires_at: past }, NOW),
    'expired'
  );
});

test('deriveConsentStatus leaves a live pending request pending', () => {
  assert.strictEqual(
    deriveConsentStatus({ status: 'pending', expires_at: future }, NOW),
    'pending'
  );
});

test('deriveConsentStatus treats a pending request with no expiry as pending', () => {
  assert.strictEqual(
    deriveConsentStatus({ status: 'pending', expires_at: null }, NOW),
    'pending'
  );
});

test('isPolicyStale only fires when a required version is set and differs', () => {
  // Mirrors the frontend's isPolicyStale so /school/consent/status and
  // normalizeConsentStatus can never disagree about what "stale" means.
  assert.strictEqual(isPolicyStale({ policy_version: '1' }, '2'), true);
  assert.strictEqual(isPolicyStale({ policy_version: '1' }, '1'), false);
  assert.strictEqual(isPolicyStale({ policy_version: '1' }, null), false);
  assert.strictEqual(isPolicyStale(null, '2'), false);
});

test('isPolicyStale compares versions as strings, not by type', () => {
  // MySQL hands back a VARCHAR; a caller may pass a number from JSON.
  assert.strictEqual(isPolicyStale({ policy_version: '2' }, 2), false);
});

test('isMutable is true only while a request is still answerable', () => {
  assert.strictEqual(isMutable({ status: 'pending', expires_at: future }, NOW), true);
  assert.strictEqual(isMutable({ status: 'pending', expires_at: past }, NOW), false);
  assert.strictEqual(isMutable({ status: 'agreed', expires_at: future }, NOW), false);
  assert.strictEqual(isMutable({ status: 'refused', expires_at: future }, NOW), false);
  assert.strictEqual(isMutable(null, NOW), false);
});
