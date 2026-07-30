'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const connPath = resolve('mysql/database/config.js');
const controllerPath = resolve('mysql/controllers/members.js');

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

function makeLeases(count) {
  return Array.from({ length: count }, (_, i) => ({
    company_id: 137,
    member_id: i + 1,
    device_id: 1000 + i,
  }));
}

function loadController({ leases, failOnQueryIndex = null } = {}) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];

  let queryCount = 0;
  const dbConnection = {
    query: async (sql) => {
      const thisCall = queryCount++;
      dbConnectionCalls.push({ type: 'query', sql });
      if (failOnQueryIndex !== null && thisCall === failOnQueryIndex) {
        throw new Error('simulated failure');
      }
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => dbConnectionCalls.push({ type: 'beginTransaction' }),
    commit: async () => dbConnectionCalls.push({ type: 'commit' }),
    rollback: async () => dbConnectionCalls.push({ type: 'rollback' }),
    release: () => dbConnectionCalls.push({ type: 'release' }),
  };

  const pool = {
    query: async (sql) => {
      if (sql.includes('SELECT madl.company_id')) return [leases];
      return [[]];
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
  dbConnectionCalls = [];
});

describe('bulkReturnMemberLeases batching + atomicity', () => {
  it('batches both the lease-return and restock UPDATEs inside one transaction', async () => {
    const leases = makeLeases(1200);
    const { bulkReturnMemberLeases } = loadController({ leases });

    const res = mockRes();
    await bulkReturnMemberLeases({ body: { company_id: 137 } }, res);

    const queryCalls = dbConnectionCalls.filter((c) => c.type === 'query');
    // 1200 leases / 500-per-batch => 3 lease-update batches + 3 restock batches (1200 unique device ids)
    assert.equal(queryCalls.length, 6);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'beginTransaction').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 200);
    assert.equal(res._body.returned, 1200);
  });

  it('skips the restock batches entirely for return_status=lost', async () => {
    const leases = makeLeases(50);
    const { bulkReturnMemberLeases } = loadController({ leases });

    const res = mockRes();
    await bulkReturnMemberLeases({ body: { company_id: 137, return_status: 'lost' } }, res);

    const queryCalls = dbConnectionCalls.filter((c) => c.type === 'query');
    // only the lease-update batch, no restock UPDATE for lost devices
    assert.equal(queryCalls.length, 1);
    assert.equal(res._body.devicesRestocked, 0);
  });

  it('rolls back BOTH the lease-return and restock writes if the restock UPDATE fails', async () => {
    const leases = makeLeases(10);
    // index 0 = the single lease-update batch (succeeds), index 1 = the restock batch (fails)
    const { bulkReturnMemberLeases } = loadController({ leases, failOnQueryIndex: 1 });

    const res = mockRes();
    await bulkReturnMemberLeases({ body: { company_id: 137 } }, res);

    assert.equal(dbConnectionCalls.filter((c) => c.type === 'rollback').length, 1);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'commit').length, 0);
    assert.equal(dbConnectionCalls.filter((c) => c.type === 'release').length, 1);
    assert.equal(res._code, 500);
  });
});
