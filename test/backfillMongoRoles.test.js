'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

const { buildUserIdBackfill } = require('../scripts/backfillMongoRoles');

// ─── buildUserIdBackfill ──────────────────────────────────────────────────────

test('buildUserIdBackfill: setea userId cuando falta y hay AdminUser por email', () => {
  const emp = { user: 'grodriguez@contextglobal.com', roleType: 'root_admin' };
  const byEmail = { 'grodriguez@contextglobal.com': 'ID-123' };
  assert.deepEqual(
    buildUserIdBackfill(emp, 2, byEmail),
    { path: 'employees.2.userId', value: 'ID-123' },
  );
});

test('buildUserIdBackfill: no toca employees que ya tienen userId', () => {
  const emp = { user: 'a@b.com', userId: 'existing' };
  assert.equal(buildUserIdBackfill(emp, 0, { 'a@b.com': 'ID-1' }), null);
});

test('buildUserIdBackfill: null si no existe AdminUser con ese email', () => {
  const emp = { user: 'ghost@b.com' };
  assert.equal(buildUserIdBackfill(emp, 0, {}), null);
});

test('buildUserIdBackfill: incluye employees inactivos (no filtra por active)', () => {
  const emp = { user: 'inactivo@b.com', active: false };
  const byEmail = { 'inactivo@b.com': 'ID-9' };
  assert.deepEqual(
    buildUserIdBackfill(emp, 0, byEmail),
    { path: 'employees.0.userId', value: 'ID-9' },
  );
});
