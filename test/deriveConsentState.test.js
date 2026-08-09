'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveConsentState } = require('../mysql/controllers/school');

const DAY = 86400000;
const now = new Date('2026-08-09T12:00:00Z');
const live = new Date(now.getTime() + 6 * DAY);
const lapsed = new Date(now.getTime() - 3 * DAY);

test('no consent row at all reads as missing', () => {
  assert.equal(deriveConsentState([], '2', now), 'missing');
  assert.equal(deriveConsentState(undefined, '2', now), 'missing');
});

test('agreed at the required policy version is agreed', () => {
  assert.equal(
    deriveConsentState([{ policy_version: '2', status: 'agreed' }], '2', now),
    'agreed'
  );
});

test('agreed against a superseded policy version is stale, not compliant', () => {
  // The distinction the binary summary could not make: this guardian DID sign,
  // but the school has since published a new policy, so they must re-consent.
  assert.equal(
    deriveConsentState([{ policy_version: '1', status: 'agreed' }], '2', now),
    'stale'
  );
});

test('pending separates a live link from a lapsed one', () => {
  assert.equal(
    deriveConsentState(
      [{ policy_version: '2', status: 'pending', otc_expires_at: live }],
      '2',
      now
    ),
    'pending'
  );
  assert.equal(
    deriveConsentState(
      [{ policy_version: '2', status: 'pending', otc_expires_at: lapsed }],
      '2',
      now
    ),
    'expired'
  );
});

test('refused is preserved rather than collapsing into missing', () => {
  assert.equal(
    deriveConsentState([{ policy_version: '2', status: 'refused' }], '2', now),
    'refused'
  );
});

test('the row at the required version governs, whatever else exists', () => {
  const rows = [
    { policy_version: '1', status: 'agreed' },
    { policy_version: '2', status: 'refused' },
  ];
  assert.equal(deriveConsentState(rows, '2', now), 'refused');
});

test('with no required version configured, staleness is unreachable', () => {
  assert.equal(
    deriveConsentState([{ policy_version: '1', status: 'agreed' }], null, now),
    'agreed'
  );
});

test('version comparison survives numeric vs string drift', () => {
  assert.equal(
    deriveConsentState([{ policy_version: 2, status: 'agreed' }], 2, now),
    'agreed'
  );
  assert.equal(
    deriveConsentState([{ policy_version: 1, status: 'agreed' }], '2', now),
    'stale'
  );
});

test('falls back to the most recent row when none matches the required version', () => {
  const rows = [
    { policy_version: '1', status: 'refused', responded_at: new Date(now.getTime() - 30 * DAY) },
    { policy_version: '3', status: 'agreed', responded_at: new Date(now.getTime() - 2 * DAY) },
  ];
  // Newest wins, and it is against a non-required version, so: stale.
  assert.equal(deriveConsentState(rows, '2', now), 'stale');
});

test('an unrecognised status is treated as missing, never as consent', () => {
  assert.equal(
    deriveConsentState([{ policy_version: '2', status: null }], '2', now),
    'missing'
  );
  assert.equal(
    deriveConsentState([{ policy_version: '2', status: 'revoked' }], '2', now),
    'missing'
  );
});
