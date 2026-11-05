'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const jwt    = require('jsonwebtoken');
const path   = require('node:path');

process.env.SECRET_JWT_SEED       = 'test-seed-for-tests';
process.env.JWT_SECRET             = 'test-seed-for-tests';

// ─── Stub: SQL connection — simula staff_member lookup ────────────────────────
const sqlConnPath = require.resolve('../mysql/database/config');
require.cache[sqlConnPath] = {
  id: sqlConnPath, filename: sqlConnPath, loaded: true,
  exports: () => ({
    execute: async (sql, params) => {
      if (sql.includes('FROM staff_member') && params[0] === 'grodriguez@contextglobal.com') {
        return [[{ staff_id: 74 }]];
      }
      if (sql.includes('FROM staff_member')) {
        return [[]]; // email not found
      }
      return [[]];
    },
  }),
};

// ─── Stub: AdminUser ──────────────────────────────────────────────────────────
const adminUserPath = require.resolve('../models/AdminUser');
require.cache[adminUserPath] = {
  id: adminUserPath, filename: adminUserPath, loaded: true,
  exports: {
    findOne: () => null, // no usado en generateJWT
  },
};

const { generateJWT } = require('../helpers/jwt');

// ─── Tests ────────────────────────────────────────────────────────────────────

test('generateJWT: incluye sqlStaffId en el payload cuando se provee', async () => {
  const token = await generateJWT('661d7f57b5dd5c170d866933', 'Gustavo', 1, 74);
  const decoded = jwt.decode(token);

  assert.equal(decoded.uid,        '661d7f57b5dd5c170d866933');
  assert.equal(decoded.sqlStaffId, 74);
  assert.equal(decoded.name,       'Gustavo');
});

test('generateJWT: funciona sin sqlStaffId (backwards-compat — token legado)', async () => {
  const token = await generateJWT('661d7f57b5dd5c170d866933', 'Gustavo', 1);
  const decoded = jwt.decode(token);

  assert.equal(decoded.uid, '661d7f57b5dd5c170d866933');
  assert.ok(!('sqlStaffId' in decoded) || decoded.sqlStaffId == null,
    'token legado no debe tener sqlStaffId o debe ser null');
});

test('generateJWT: sqlStaffId null cuando el staff_member no existe en SQL', async () => {
  const token = await generateJWT('661d7f57b5dd5c170d866933', 'Ghost', 1, null);
  const decoded = jwt.decode(token);

  assert.equal(decoded.sqlStaffId, null);
});
