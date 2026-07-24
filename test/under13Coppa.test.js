'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const membersControllerPath = path.resolve(__dirname, '../mysql/controllers/members.js');
const schoolControllerPath = path.resolve(__dirname, '../mysql/controllers/school.js');
const dbPath = path.resolve(__dirname, '../mysql/database/config.js');
const staffActivityLogPath = path.resolve(__dirname, '../models/StaffActivityLog.js');
const loggerPath = path.resolve(__dirname, '../helpers/logger.js');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function withController(controllerPath, pool, fn) {
  const originals = new Map(
    [controllerPath, dbPath, staffActivityLogPath, loggerPath].map((modulePath) => [
      modulePath,
      require.cache[modulePath],
    ])
  );
  delete require.cache[controllerPath];
  require.cache[dbPath] = { exports: () => pool };
  require.cache[staffActivityLogPath] = { exports: { create: async () => {}, find: () => ({}) } };
  require.cache[loggerPath] = { exports: { error() {} } };
  const controller = require(controllerPath);
  return Promise.resolve()
    .then(() => fn(controller))
    .finally(() => {
      for (const [modulePath, cachedModule] of originals) {
        if (cachedModule) require.cache[modulePath] = cachedModule;
        else delete require.cache[modulePath];
      }
    });
}

const leaseSchema = [
  { Field: 'member_id' },
  { Field: 'staff_member_id' },
  { Field: 'device_id' },
  { Field: 'company_id' },
  { Field: 'expected_return_date' },
  { Field: 'returned' },
];

function createMembersPool({ dob = '2016-07-23', coppaOn = true, consentRows = [] } = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql === 'SHOW COLUMNS FROM member_assigned_device_lease') return [leaseSchema];
      if (sql.includes('FROM members_info WHERE member_id IN')) {
        return [[{
          member_id: 10,
          first_name: 'Ada',
          last_name: 'Student',
          minor: 0,
          date_of_birth: dob,
          parent_guardian_first_name: null,
          parent_guardian_last_name: null,
          parent_guardian_email: null,
        }]];
      }
      if (sql.includes('enforce_member_consent = 1')) return [[]];
      if (sql.includes('enforce_under_13_consent = 1')) {
        return [coppaOn ? [{ company_id: 77, enforce_under_13_consent: 1, required_consent_policy_version: '2' }] : []];
      }
      if (sql.includes('FROM school_consent')) return [consentRows];
      if (sql.includes('INSERT INTO member_assigned_device_lease')) return [{ affectedRows: 1, insertId: 123 }];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

async function assignDevice(pool) {
  const res = createResponse();
  await withController(membersControllerPath, pool, async (controller) => {
    await controller.insertNewRowINMemberAssignedDeviceTableForLeaseTracking(
      { body: { member_id: 10, staff_member_id: 5, device_id: 20, company_id: 77 } },
      res
    );
  });
  return res;
}

test('device assignment blocks under-13 without consent when COPPA enforcement is on', async () => {
  const res = await assignDevice(createMembersPool());
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'UNDER_13_CONSENT_REQUIRED');
  assert.deepEqual(res.body.members, [10]);
});

test('device assignment allows under-13 with valid consent', async () => {
  const res = await assignDevice(createMembersPool({
    consentRows: [{ member_id: 10, company_id: 77, policy_version: '2' }],
  }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
});

test('device assignment allows 13+ without consent', async () => {
  const res = await assignDevice(createMembersPool({ dob: '2013-07-23' }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
});

test('device assignment allows under-13 when COPPA enforcement is off', async () => {
  const res = await assignDevice(createMembersPool({ coppaOn: false }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
});

test('settings endpoint returns COPPA fields', async () => {
  const pool = {
    query: async (sql) => {
      assert.match(sql, /enforce_under_13_consent/);
      return [[{
        enforce_member_consent: 1,
        enforce_under_13_consent: 1,
        required_consent_policy_version: '2',
      }]];
    },
  };
  await withController(schoolControllerPath, pool, async (controller) => {
    const res = createResponse();
    await controller.getSchoolSettings({ body: { company_id: 77 } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.settings, {
      enforce_member_consent: true,
      enforce_under_13_consent: true,
      required_consent_policy_version: '2',
    });
  });
});

test('setConsentEnforcement stores COPPA settings and required policy version', async () => {
  const executed = [];
  const pool = {
    execute: async (sql, params) => {
      executed.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  await withController(schoolControllerPath, pool, async (controller) => {
    const res = createResponse();
    await controller.setConsentEnforcement(
      { body: { company_id: 77, enforce: true, enforce_under_13: true, required_consent_policy_version: '2' } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.match(executed[0].sql, /required_consent_policy_version/);
    assert.deepEqual(executed[0].params, [77, 1, 1, '2']);
    assert.equal(res.body.settings.enforce_under_13_consent, true);
  });
});

test('consent status includes under_13 per member', async () => {
  const pool = {
    query: async (sql) => {
      assert.match(sql, /date_of_birth/);
      return [[
        { member_id: 10, first_name: 'Ada', last_name: 'Student', grade: '5', date_of_birth: '2016-07-23', consented: 0 },
        { member_id: 11, first_name: 'Teen', last_name: 'Student', grade: '8', date_of_birth: '2013-07-23', consented: 1 },
      ]];
    },
  };
  await withController(schoolControllerPath, pool, async (controller) => {
    const res = createResponse();
    await controller.consentStatus({ body: { company_id: 77 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.members[0].under_13, true);
    assert.equal(res.body.members[1].under_13, false);
    assert.equal(res.body.missing[0].under_13, true);
  });
});
