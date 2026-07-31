'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const connPath = resolve('mysql/database/config.js');
const controllerPath = resolve('mysql/controllers/company.js');

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

function baseReqBody(items) {
  return {
    category_name: 'Cameras', item_group: 'DSLR', cost: 100, brand: 'Canon',
    descript_item: 'desc', ownership: 'owned', main_warehouse: 'main',
    warehouse: 'wh1', company: 'ACME', location: 'loc1', sub_location: 'sub1',
    current_location: 'loc1', extra_serial_number: ['x'], company_id: 5,
    return_date: null, update_at: '2026-07-07', enableAssignFeature: 1,
    container: null, containerSpotLimit: null, image_url: null,
    data: JSON.stringify(items),
  };
}

function loadController({ failOnBatchIndex = null } = {}) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];

  let updateCallCount = 0;
  const dbConnection = {
    execute: async (sql, params) => {
      const thisBatch = updateCallCount++;
      dbConnectionCalls.push({ type: 'execute', sql, params });
      if (failOnBatchIndex !== null && thisBatch === failOnBatchIndex) {
        throw new Error('simulated batch failure');
      }
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => dbConnectionCalls.push({ type: 'beginTransaction' }),
    commit: async () => dbConnectionCalls.push({ type: 'commit' }),
    rollback: async () => dbConnectionCalls.push({ type: 'rollback' }),
    release: () => dbConnectionCalls.push({ type: 'release' }),
  };

  const pool = { getConnection: async () => dbConnection };

  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => pool,
  };

  return require('../mysql/controllers/company');
}

beforeEach(() => {
  dbConnectionCalls = [];
});

describe('updateGroupItems batching', () => {
  it('splits a large copy list into multiple batched CASE/WHEN UPDATEs inside one transaction', async () => {
    const { updateGroupItems } = loadController();
    const items = Array.from({ length: 1200 }, (_, i) => ({ item_id: i + 1, serial_number: `SN-${i}` }));
    const req = { body: baseReqBody(items) };
    const res = mockRes();

    await updateGroupItems(req, res);

    const executeCalls = dbConnectionCalls.filter((c) => c.type === 'execute');
    // 1200 items / 500-per-batch default => 3 batches
    assert.equal(executeCalls.length, 3);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'beginTransaction').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 200);
  });

  it('rolls back and releases the connection if a batch fails mid-way', async () => {
    const { updateGroupItems } = loadController({ failOnBatchIndex: 1 });
    const items = Array.from({ length: 1200 }, (_, i) => ({ item_id: i + 1, serial_number: `SN-${i}` }));
    const req = { body: baseReqBody(items) };
    const res = mockRes();

    await updateGroupItems(req, res);

    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 500);
  });
});
