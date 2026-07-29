'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const connPath = resolve('mysql/database/config.js');
const controllerPath = resolve('mysql/controllers/item.js');
const staffAccessPath = resolve('mysql/helpers/staffAccess.js');

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

function loadController({ failOnBatchIndex = null } = {}) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];
  delete require.cache[staffAccessPath];

  let batchCount = 0;
  const dbConnection = {
    query: async (sql, params) => {
      const thisBatch = batchCount++;
      dbConnectionCalls.push({ type: 'query', sql, params });
      if (failOnBatchIndex !== null && thisBatch === failOnBatchIndex) {
        throw new Error('simulated batch failure');
      }
      const rowsInBatch = Array.isArray(params?.[0]) ? params[0].length : 0;
      return [{ affectedRows: rowsInBatch, insertId: thisBatch === 0 ? 99 : 0 }];
    },
    beginTransaction: async () => dbConnectionCalls.push({ type: 'beginTransaction' }),
    commit: async () => dbConnectionCalls.push({ type: 'commit' }),
    rollback: async () => dbConnectionCalls.push({ type: 'rollback' }),
    release: () => dbConnectionCalls.push({ type: 'release' }),
  };

  // route() answers whatever query is fired directly on the pool (location
  // lookup, staffAccess's role/scope lookup) -- keyed by a SQL substring so
  // call order doesn't matter.
  const route = (sql) => {
    if (sql.includes('FROM locations')) return [[{ location_id: 1 }]];
    if (sql.includes('FROM company_staff cs')) {
      // role_level 0 => FULL_INVENTORY_ROLES, canWriteInScope always true
      return [[{ company_staff_id: 'staff-1', role_type: 'root_admin', role_level: 0, location_ids: null, category_ids: null }]];
    }
    return [[]];
  };

  const pool = {
    query: async (sql) => route(sql),
    execute: async (sql) => route(sql),
    getConnection: async () => dbConnection,
  };

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

describe('insertBulkItem batching', () => {
  it('splits a large serial-number range into multiple batched INSERTs inside one transaction', async () => {
    const { insertBulkItem } = loadController();
    const req = {
      body: {
        category_name: 'Laptop',
        item_group: 'Devices',
        cost: 100,
        brand: 'Dell',
        ownership: 'owned',
        min_serial_number: '000001',
        max_serial_number: '001200', // 1200 serials
        warehouse: 1,
        company: 'Acme',
        location: 'Main',
        company_id: 137,
      },
      sqlStaffId: 1,
    };

    const res = mockRes();
    await insertBulkItem(req, res);

    const queryCalls = dbConnectionCalls.filter((c) => c.type === 'query');
    // 1200 rows / 500-per-batch default => 3 batches (500, 500, 200)
    assert.equal(queryCalls.length, 3);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'beginTransaction').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 201);
    assert.equal(res._body.item.affectedRows, 1200);
  });

  it('rolls back and releases the connection if a batch fails mid-way', async () => {
    const { insertBulkItem } = loadController({ failOnBatchIndex: 1 });
    const req = {
      body: {
        category_name: 'Laptop',
        item_group: 'Devices',
        cost: 100,
        brand: 'Dell',
        ownership: 'owned',
        min_serial_number: '000001',
        max_serial_number: '001200',
        warehouse: 1,
        company: 'Acme',
        location: 'Main',
        company_id: 137,
      },
      sqlStaffId: 1,
    };

    const res = mockRes();
    await insertBulkItem(req, res);

    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 500);
  });
});
