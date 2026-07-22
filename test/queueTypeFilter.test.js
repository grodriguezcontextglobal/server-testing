'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const core = require(path.resolve(__dirname, '../queue/core.js'));

const NOW = new Date('2026-07-22T10:00:00Z').getTime();

test('no type options => no type filter (single worker takes everything)', () => {
  const f = core.buildClaimFilter(NOW);
  assert.equal(f.status, 'pending');
  assert.deepEqual(f.nextAttemptAt, { $lte: new Date(NOW) });
  assert.equal('type' in f, false);
});

test('includeTypes => type $in (dedicated worker, e.g. email-worker)', () => {
  const f = core.buildClaimFilter(NOW, { includeTypes: ['send-email', 'send-email-multiple'] });
  assert.deepEqual(f.type, { $in: ['send-email', 'send-email-multiple'] });
});

test('excludeTypes => type $nin (main worker skips email types)', () => {
  const f = core.buildClaimFilter(NOW, { excludeTypes: ['send-email'] });
  assert.deepEqual(f.type, { $nin: ['send-email'] });
});

test('both include and exclude => combined $in + $nin', () => {
  const f = core.buildClaimFilter(NOW, { includeTypes: ['a', 'b'], excludeTypes: ['b'] });
  assert.deepEqual(f.type, { $in: ['a', 'b'], $nin: ['b'] });
});

test('empty arrays are treated as no filter', () => {
  const f = core.buildClaimFilter(NOW, { includeTypes: [], excludeTypes: [] });
  assert.equal('type' in f, false);
});

test('falsy entries are dropped from the type lists', () => {
  const f = core.buildClaimFilter(NOW, { includeTypes: ['send-email', '', null, undefined] });
  assert.deepEqual(f.type, { $in: ['send-email'] });
});

test('base filter (status + nextAttemptAt) is always present', () => {
  const f = core.buildClaimFilter(NOW, { includeTypes: ['x'] });
  assert.equal(f.status, 'pending');
  assert.deepEqual(f.nextAttemptAt, { $lte: new Date(NOW) });
});
