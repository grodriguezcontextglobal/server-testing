'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { runExpireConsents, EXPIRE_QUERY } = require(
  path.resolve(__dirname, '../scheduler/consentExpiry.js')
);

test('EXPIRE_QUERY only targets pending rows with a lapsed otc_expires_at', () => {
  assert.match(EXPIRE_QUERY, /status = 'pending'/);
  assert.match(EXPIRE_QUERY, /otc_expires_at < NOW\(\)/);
  assert.match(EXPIRE_QUERY, /SET status = 'expired'/);
});

test('runExpireConsents runs the sweep and reports the affected count', async () => {
  let queried = null;
  const fakePool = {
    query: async (sql) => {
      queried = sql;
      return [{ affectedRows: 3 }];
    },
  };
  const result = await runExpireConsents({ getConnection: () => fakePool });
  assert.equal(result.expired, 3);
  assert.equal(queried, EXPIRE_QUERY);
});

test('runExpireConsents reports zero when nothing lapsed', async () => {
  const fakePool = { query: async () => [{ affectedRows: 0 }] };
  const result = await runExpireConsents({ getConnection: () => fakePool });
  assert.equal(result.expired, 0);
});
