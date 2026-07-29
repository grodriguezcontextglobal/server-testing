'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const connPath = resolve('mysql/database/config.js');
const controllerPath = resolve('mysql/controllers/members.js');

let poolQueries;
let connectionCalls;

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

// Every column referenced by insertBulkMembers' baseOrder, so the schema
// filter never drops a field the test rows send.
const SCHEMA_COLUMNS = [
  'first_name', 'last_name', 'email', 'phone_number', 'external_id',
  'address', 'address_street', 'address_city', 'address_state', 'address_zip',
  'company_id', 'grade', 'homeroom', 'date_of_birth', 'minor',
  'parent_guardian_first_name', 'parent_guardian_last_name',
  'parent_guardian_email', 'parent_guardian_phone_number',
].map((Field) => ({ Field }));

function loadController({ failOnBatchIndex = null } = {}) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];

  let batchCount = 0;
  const dbConnection = {
    query: async (sql, values) => {
      const thisBatch = batchCount++;
      connectionCalls.push({ type: 'query', sql, values });
      if (failOnBatchIndex !== null && thisBatch === failOnBatchIndex) {
        throw new Error('simulated batch failure');
      }
      return [{ affectedRows: values.length / SCHEMA_COLUMNS.length, insertId: thisBatch === 0 ? 42 : 0 }];
    },
    beginTransaction: async () => connectionCalls.push({ type: 'beginTransaction' }),
    commit: async () => connectionCalls.push({ type: 'commit' }),
    rollback: async () => connectionCalls.push({ type: 'rollback' }),
    release: () => connectionCalls.push({ type: 'release' }),
  };

  const pool = {
    query: async (sql) => {
      poolQueries.push(sql);
      return [SCHEMA_COLUMNS];
    },
    getConnection: async () => dbConnection,
  };

  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => pool,
  };

  return require('../mysql/controllers/members');
}

beforeEach(() => {
  poolQueries = [];
  connectionCalls = [];
});

describe('insertBulkMembers batching', () => {
  it('splits a large payload into multiple batched INSERTs inside one transaction', async () => {
    const { insertBulkMembers } = loadController();
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      first_name: `First${i}`,
      last_name: `Last${i}`,
      company_id: 137,
    }));

    const res = mockRes();
    await insertBulkMembers({ body: { rows } }, res);

    const queryCalls = connectionCalls.filter((c) => c.type === 'query');
    // 1200 rows / 500-per-batch default => 3 batches (500, 500, 200)
    assert.equal(queryCalls.length, 3);
    assert.equal(connectionCalls.filter((c) => c.type === 'beginTransaction').length, 1);
    assert.equal(connectionCalls.filter((c) => c.type === 'commit').length, 1);
    assert.equal(connectionCalls.filter((c) => c.type === 'rollback').length, 0);
    assert.equal(connectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 201);
    assert.equal(res._body.inserted, 1200);
  });

  it('rolls back and releases the connection if a batch fails mid-way', async () => {
    const { insertBulkMembers } = loadController({ failOnBatchIndex: 1 });
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      first_name: `First${i}`,
      last_name: `Last${i}`,
      company_id: 137,
    }));

    const res = mockRes();
    await insertBulkMembers({ body: { rows } }, res);

    assert.equal(connectionCalls.filter((c) => c.type === 'rollback').length, 1);
    assert.equal(connectionCalls.filter((c) => c.type === 'commit').length, 0);
    assert.equal(connectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 500);
  });

  it('issues a single batch for small payloads (no behavior change for normal use)', async () => {
    const { insertBulkMembers } = loadController();
    const rows = [
      { first_name: 'A', last_name: 'One', company_id: 137 },
      { first_name: 'B', last_name: 'Two', company_id: 137 },
    ];

    const res = mockRes();
    await insertBulkMembers({ body: { rows } }, res);

    const queryCalls = connectionCalls.filter((c) => c.type === 'query');
    assert.equal(queryCalls.length, 1);
    assert.equal(res._code, 201);
    assert.equal(res._body.inserted, 2);
  });
});
