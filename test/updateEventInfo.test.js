'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const connPath = resolve('mysql/database/config.js');
const controllerPath = resolve('mysql/controllers/events.js');

let executedQuery;
let executedValues;
let affectedRows = 1;

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

function loadController() {
  delete require.cache[connPath];
  delete require.cache[controllerPath];

  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => ({
      getConnection: async () => ({
        execute: async (query, values) => {
          executedQuery = query;
          executedValues = values;
          return [{ affectedRows }];
        },
        release: () => {},
      }),
      execute: async () => [[]],
    }),
  };

  return require('../mysql/controllers/events');
}

beforeEach(() => {
  executedQuery = undefined;
  executedValues = undefined;
  affectedRows = 1;
});

describe('updateEventInfo', () => {
  it('allows updating the SQL event configuration field', async () => {
    const { updateEventInfo } = loadController();
    const req = {
      params: { event_id: '676' },
      body: { configuration: 'completed' },
    };
    const res = mockRes();

    await updateEventInfo(req, res);

    assert.equal(res._code, 200);
    assert.equal(res._body.ok, true);
    assert.equal(executedQuery, 'UPDATE event_info SET `configuration` = ? WHERE event_id = ?');
    assert.deepEqual(executedValues, ['completed', '676']);
  });

  it('still rejects fields outside the SQL event_info allowlist', async () => {
    const { updateEventInfo } = loadController();
    const req = {
      params: { event_id: '676' },
      body: { configuration: 'completed', 'configuration = hacked': 'bad' },
    };
    const res = mockRes();

    await updateEventInfo(req, res);

    assert.equal(res._code, 400);
    assert.equal(res._body.ok, false);
    assert.equal(res._body.msg, 'Invalid field(s): configuration = hacked');
    assert.equal(executedQuery, undefined);
  });
});
