'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const connPath = resolve('mysql/database/config.js');
const controllerPath = resolve('mysql/controllers/location.js');

let dbConnectionCalls;
let poolLevelCallAttempted;

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

function loadController({ failOnBatchIndex = null } = {}) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];

  let updateCallCount = 0;
  const dbConnection = {
    execute: async (sql, params) => {
      if (sql.includes('FROM locations')) {
        return [[{ location_name: 'Main Warehouse' }]];
      }
      // UPDATE item_inv batch
      const thisBatch = updateCallCount++;
      dbConnectionCalls.push({ type: 'execute', sql, params });
      if (failOnBatchIndex !== null && thisBatch === failOnBatchIndex) {
        throw new Error('simulated batch failure');
      }
      // params = [location_id, location_name, ...batchItemIds, company_id]
      const batchSize = params.length - 3;
      return [{ affectedRows: batchSize }];
    },
    beginTransaction: async () => dbConnectionCalls.push({ type: 'beginTransaction' }),
    commit: async () => dbConnectionCalls.push({ type: 'commit' }),
    rollback: async () => dbConnectionCalls.push({ type: 'rollback' }),
    release: () => dbConnectionCalls.push({ type: 'release' }),
  };

  const pool = {
    // The old bug called these straight on the pool -- fail loudly if that
    // ever happens again instead of silently "working" on the mock.
    beginTransaction: async () => {
      poolLevelCallAttempted = true;
      throw new Error('beginTransaction is not a function');
    },
    execute: async () => {
      poolLevelCallAttempted = true;
      throw new Error('execute called on pool instead of a dedicated connection');
    },
    getConnection: async () => dbConnection,
  };

  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => pool,
  };

  return require('../mysql/controllers/location');
}

beforeEach(() => {
  dbConnectionCalls = [];
  poolLevelCallAttempted = false;
});

describe('bulkAssignInventory', () => {
  it('runs entirely on a dedicated connection, never the pool directly', async () => {
    const { bulkAssignInventory } = loadController();
    const req = { params: { id: 5 }, body: { item_ids: [1, 2, 3], company_id: 137 } };
    const res = mockRes();

    await bulkAssignInventory(req, res);

    assert.equal(poolLevelCallAttempted, false);
    assert.equal(res._code, 200);
  });

  it('splits a large item_ids array into multiple batched UPDATEs inside one transaction', async () => {
    const { bulkAssignInventory } = loadController();
    const item_ids = Array.from({ length: 1200 }, (_, i) => i + 1);
    const req = { params: { id: 5 }, body: { item_ids, company_id: 137 } };
    const res = mockRes();

    await bulkAssignInventory(req, res);

    const executeCalls = dbConnectionCalls.filter((c) => c.type === 'execute');
    // 1200 ids / 500-per-batch default => 3 batches (500, 500, 200)
    assert.equal(executeCalls.length, 3);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'beginTransaction').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 200);
    assert.equal(res._body.updated_count, 1200);
  });

  it('rolls back and releases the connection if a batch fails mid-way', async () => {
    const { bulkAssignInventory } = loadController({ failOnBatchIndex: 1 });
    const item_ids = Array.from({ length: 1200 }, (_, i) => i + 1);
    const req = { params: { id: 5 }, body: { item_ids, company_id: 137 } };
    const res = mockRes();

    await bulkAssignInventory(req, res);

    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 500);
  });

  it('returns 404 without ever attempting an UPDATE when the location does not exist', async () => {
    delete require.cache[connPath];
    delete require.cache[controllerPath];

    const dbConnection = {
      execute: async (sql) => (sql.includes('FROM locations') ? [[]] : [{ affectedRows: 0 }]),
      beginTransaction: async () => dbConnectionCalls.push({ type: 'beginTransaction' }),
      commit: async () => dbConnectionCalls.push({ type: 'commit' }),
      rollback: async () => dbConnectionCalls.push({ type: 'rollback' }),
      release: () => dbConnectionCalls.push({ type: 'release' }),
    };
    require.cache[connPath] = {
      id: connPath,
      filename: connPath,
      loaded: true,
      exports: () => ({ getConnection: async () => dbConnection }),
    };
    const { bulkAssignInventory } = require('../mysql/controllers/location');

    const req = { params: { id: 999 }, body: { item_ids: [1], company_id: 137 } };
    const res = mockRes();

    await bulkAssignInventory(req, res);

    assert.equal(res._code, 404);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
  });
});
