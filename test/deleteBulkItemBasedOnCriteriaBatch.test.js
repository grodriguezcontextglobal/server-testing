'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const connPath = resolve('mysql/database/config.js');
const controllerPath = resolve('mysql/controllers/item.js');

let dbConnectionCalls;

function mockRes() {
  const res = {};
  res.status = (code) => {
    res._code = code;
    return res;
  };
  res.json = (body) => {
    res._body = body;
    return res;
  };
  return res;
}

// FULL_INVENTORY_ROLES (role_level 0) -> userAccess.scoped === false, so the
// function's DELETE path runs unrestricted (no location/category narrowing).
function loadController({ affectedRowsPerBatch = () => 10, failOnBatchIndex = null } = {}) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];

  let deleteCallCount = 0;
  const execute = async (sql, values) => {
    if (sql.includes('FROM company_staff cs')) {
      return [[{ company_staff_id: 'staff-1', role_type: 'root_admin', role_level: 0, location_ids: null, category_ids: null }]];
    }
    if (sql.startsWith('DELETE FROM item_inv')) {
      const thisBatch = deleteCallCount++;
      dbConnectionCalls.push({ type: 'delete', sql, values });
      if (failOnBatchIndex !== null && thisBatch === failOnBatchIndex) {
        throw new Error('simulated batch failure');
      }
      return [{ affectedRows: affectedRowsPerBatch(thisBatch) }];
    }
    return [[]];
  };
  const dbConnection = {
    execute,
    beginTransaction: async () => dbConnectionCalls.push({ type: 'beginTransaction' }),
    commit: async () => dbConnectionCalls.push({ type: 'commit' }),
    rollback: async () => dbConnectionCalls.push({ type: 'rollback' }),
    release: () => dbConnectionCalls.push({ type: 'release' }),
  };

  // getStaffCompanyAccess calls getConnection().execute(...) directly on the
  // pool (its own internal getConnection() call), not through the dedicated
  // connection this controller opens for its transaction.
  const pool = { execute, getConnection: async () => dbConnection };

  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => pool,
  };

  return require('../mysql/controllers/item');
}

beforeEach(() => {
  dbConnectionCalls = [];
});

describe('deleteBulkItemBasedOnCriteria serial_number batching', () => {
  it('splits a large serial_number list into multiple batched DELETEs inside one transaction', async () => {
    const { deleteBulkItemBasedOnCriteria } = loadController();
    const serial_number = Array.from({ length: 1200 }, (_, i) => `SN-${i}`);
    const req = {
      body: { company_id: 137, category_name: 'Laptop', serial_number },
      sqlStaffId: 1,
    };
    const res = mockRes();

    await deleteBulkItemBasedOnCriteria(req, res);

    const deletes = dbConnectionCalls.filter((c) => c.type === 'delete');
    // 1200 serials / 500-per-batch default => 3 batches
    assert.equal(deletes.length, 3);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'beginTransaction').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 200);
    assert.equal(res._body.deleted_count, 30); // 10 affectedRows x 3 batches
  });

  it('runs a single DELETE when no serial_number filter is given', async () => {
    const { deleteBulkItemBasedOnCriteria } = loadController();
    const req = {
      body: { company_id: 137, category_name: 'Laptop' },
      sqlStaffId: 1,
    };
    const res = mockRes();

    await deleteBulkItemBasedOnCriteria(req, res);

    const deletes = dbConnectionCalls.filter((c) => c.type === 'delete');
    assert.equal(deletes.length, 1);
    assert.equal(res._code, 200);
  });

  it('rolls back and releases the connection if a later batch fails', async () => {
    const { deleteBulkItemBasedOnCriteria } = loadController({ failOnBatchIndex: 1 });
    const serial_number = Array.from({ length: 1200 }, (_, i) => `SN-${i}`);
    const req = {
      body: { company_id: 137, category_name: 'Laptop', serial_number },
      sqlStaffId: 1,
    };
    const res = mockRes();

    await deleteBulkItemBasedOnCriteria(req, res);

    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 500);
  });
});
