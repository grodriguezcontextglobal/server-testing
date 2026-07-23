'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const connPath = resolve('mysql/database/config.js');
const controllerPath = resolve('mysql/controllers/members.js');

let queries;

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

function loadController(rows = []) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];

  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => ({
      query: async (sql, values) => {
        queries.push({ sql, values });
        return [rows];
      },
    }),
  };

  return require('../mysql/controllers/members');
}

beforeEach(() => {
  queries = [];
});

describe('retrieveOverdueLeases', () => {
  it('queries overdue leases without referencing a missing lease_id column', async () => {
    const { retrieveOverdueLeases } = loadController();
    const res = mockRes();

    await retrieveOverdueLeases({ body: { company_id: 137 } }, res);

    assert.equal(res._code, 200);
    assert.equal(res._body.ok, true);
    assert.equal(queries.length, 1);
    assert.doesNotMatch(queries[0].sql, /\bmadl\.lease_id\b|\blease_id\b/i);
  });

  it('casts expected_return_date before comparing it to NOW', async () => {
    const { retrieveOverdueLeases } = loadController();

    await retrieveOverdueLeases({ body: { company_id: 137 } }, mockRes());

    assert.match(
      queries[0].sql,
      /CAST\(madl\.expected_return_date AS DATETIME\)\s*<\s*NOW\(\)/i
    );
    assert.match(
      queries[0].sql,
      /DATEDIFF\(NOW\(\),\s*CAST\(madl\.expected_return_date AS DATETIME\)\)/i
    );
  });

  it('binds company_id as the required overdue leases filter', async () => {
    const { retrieveOverdueLeases } = loadController();

    await retrieveOverdueLeases({ body: { company_id: 137 } }, mockRes());

    assert.match(queries[0].sql, /WHERE\s+madl\.company_id\s*=\s*\?/i);
    assert.deepEqual(queries[0].values, ['137']);
  });

  it('adds the optional grade filter when provided', async () => {
    const { retrieveOverdueLeases } = loadController();

    await retrieveOverdueLeases({ body: { company_id: 137, grade: '5' } }, mockRes());

    assert.match(queries[0].sql, /AND\s+mi\.grade\s*=\s*\?/i);
    assert.deepEqual(queries[0].values, ['137', '5']);
  });
});
