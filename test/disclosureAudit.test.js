'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const controllerPath = path.resolve(__dirname, '../mysql/controllers/school.js');
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

function createFindMock(result = []) {
  const find = (query) => {
    find.lastQuery = query;
    return {
      sort(sortSpec) {
        find.lastSort = sortSpec;
        return {
          limit(limitValue) {
            find.lastLimit = limitValue;
            return { lean: async () => result };
          },
        };
      },
    };
  };
  return find;
}

function loadSchoolController({ pool, logs = [] }) {
  const originals = new Map(
    [controllerPath, dbPath, staffActivityLogPath, loggerPath].map((modulePath) => [
      modulePath,
      require.cache[modulePath],
    ])
  );

  const StaffActivityLog = {
    created: [],
    find: createFindMock(logs),
    create: async (payload) => {
      StaffActivityLog.created.push(payload);
      return payload;
    },
  };

  delete require.cache[controllerPath];
  require.cache[dbPath] = { exports: () => pool };
  require.cache[staffActivityLogPath] = { exports: StaffActivityLog };
  require.cache[loggerPath] = { exports: { error() {} } };
  const controller = require(controllerPath);

  return {
    controller,
    StaffActivityLog,
    restore() {
      for (const [modulePath, cachedModule] of originals) {
        if (cachedModule) require.cache[modulePath] = cachedModule;
        else delete require.cache[modulePath];
      }
    },
  };
}

test('studentExport logs a DISCLOSURE event after successful export', async () => {
  const pool = {
    query: async (sql) => {
      if (sql.includes('FROM members_info')) return [[{ member_id: 123, company_id: 77 }]];
      if (sql.includes('FROM student_guardian')) return [[]];
      if (sql.includes('FROM member_assigned_device_lease')) return [[]];
      if (sql.includes('FROM school_consent')) return [[]];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.studentExport(
      { uid: '64b7f2c8f1c2a3b4c5d6e7f8', body: { company_id: 77, member_id: 123 } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(loaded.StaffActivityLog.created.length, 1);
    assert.deepEqual(loaded.StaffActivityLog.created[0], {
      staff_member_id: '64b7f2c8f1c2a3b4c5d6e7f8',
      company_id: '77',
      action: 'DISCLOSURE',
      target_model: 'SchoolPII',
      target_id: '123',
      details: {
        type: 'student_export',
        purpose: 'FERPA data-subject request',
        recipient: 'staff',
        fields_exported: ['identity', 'guardians', 'leases', 'consents', 'access_log'],
      },
    });
  } finally {
    loaded.restore();
  }
});

test('studentErase logs a DISCLOSURE event after successful erase', async () => {
  const conn = {
    beginTransaction: async () => {},
    execute: async (sql) => {
      if (sql.includes('UPDATE members_info')) return [{ affectedRows: 1 }];
      if (sql.includes('UPDATE guardians')) return [{ affectedRows: 2 }];
      if (sql.includes('UPDATE school_consent')) return [{ affectedRows: 3 }];
      throw new Error(`unexpected transaction statement: ${sql}`);
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  const pool = {
    execute: async (sql) => {
      if (sql.includes('SELECT 1 FROM members_info')) return [[{ 1: 1 }]];
      if (sql.includes('COUNT(*) AS total FROM member_assigned_device_lease')) return [[{ total: 5 }]];
      throw new Error(`unexpected pool statement: ${sql}`);
    },
    getConnection: async () => conn,
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.studentErase(
      { uid: '64b7f2c8f1c2a3b4c5d6e7f8', body: { company_id: 77, member_id: 123 } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(loaded.StaffActivityLog.created.length, 1);
    assert.equal(loaded.StaffActivityLog.created[0].action, 'DISCLOSURE');
    assert.equal(loaded.StaffActivityLog.created[0].target_id, '123');
    assert.deepEqual(loaded.StaffActivityLog.created[0].details, {
      type: 'student_erase',
      purpose: 'FERPA/COPPA data-subject request',
      mode: 'anonymize',
      receipt: {
        members_info_updated: true,
        guardians_anonymized: 2,
        consents_anonymized: 3,
        leases_preserved: 5,
      },
    });
  } finally {
    loaded.restore();
  }
});

test('studentAccessLog returns filtered disclosure history', async () => {
  const logs = [
    {
      _id: 'log1',
      action: 'DISCLOSURE',
      staff_member_id: '64b7f2c8f1c2a3b4c5d6e7f8',
      timestamp: '2026-07-23T12:00:00.000Z',
      details: { type: 'student_export', purpose: 'FERPA data-subject request' },
    },
  ];
  const loaded = loadSchoolController({ pool: {}, logs });
  try {
    const res = createResponse();
    await loaded.controller.studentAccessLog(
      { body: { company_id: 77, member_id: 123, type: 'disclosure' } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(loaded.StaffActivityLog.find.lastQuery, {
      company_id: '77',
      target_id: '123',
      action: 'DISCLOSURE',
    });
    assert.deepEqual(loaded.StaffActivityLog.find.lastSort, { timestamp: -1 });
    assert.equal(loaded.StaffActivityLog.find.lastLimit, 200);
    assert.deepEqual(res.body, {
      ok: true,
      member_id: 123,
      access_log: [
        {
          id: 'log1',
          action: 'DISCLOSURE',
          staff_member_id: '64b7f2c8f1c2a3b4c5d6e7f8',
          timestamp: '2026-07-23T12:00:00.000Z',
          details: { type: 'student_export', purpose: 'FERPA data-subject request' },
        },
      ],
      count: 1,
    });
  } finally {
    loaded.restore();
  }
});

test('studentAccessLog filters access actions when type is access', async () => {
  const loaded = loadSchoolController({ pool: {}, logs: [] });
  try {
    const res = createResponse();
    await loaded.controller.studentAccessLog(
      { body: { company_id: 77, member_id: 123, type: 'access' } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(loaded.StaffActivityLog.find.lastQuery, {
      company_id: '77',
      target_id: '123',
      action: { $in: ['READ', 'CREATE', 'UPDATE', 'DELETE'] },
    });
  } finally {
    loaded.restore();
  }
});
