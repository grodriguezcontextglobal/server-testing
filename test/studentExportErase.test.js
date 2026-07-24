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

function loadSchoolController({ pool, accessLog = [] }) {
  const originals = new Map(
    [controllerPath, dbPath, staffActivityLogPath, loggerPath].map((modulePath) => [
      modulePath,
      require.cache[modulePath],
    ])
  );

  const StaffActivityLog = {
    find(query) {
      StaffActivityLog.lastQuery = query;
      return {
        sort(sortSpec) {
          StaffActivityLog.lastSort = sortSpec;
          return {
            limit(limitValue) {
              StaffActivityLog.lastLimit = limitValue;
              return {
                lean: async () => accessLog,
              };
            },
          };
        },
      };
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

test('studentExport returns student identity, guardians, leases, consents, and access log', async () => {
  const student = {
    member_id: 123,
    company_id: 77,
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.edu',
    grade: '5',
    homeroom: 'A',
    minor: 1,
    parent_guardian_first_name: 'Anne',
    parent_guardian_last_name: 'Lovelace',
    parent_guardian_email: 'anne@example.edu',
    parent_guardian_phone_number: '555-0100',
  };
  const normalizedGuardian = {
    id: 'g1',
    first_name: 'Bob',
    last_name: 'Lovelace',
    email: 'bob@example.edu',
    phone_number: '555-0101',
    relationship: 'father',
    is_primary: 0,
  };
  const leases = [{ id: 1, member_id: 123, company_id: 77, assigned_date: '2026-07-01' }];
  const consents = [{ id: 'c1', member_id: 123, company_id: 77, signer_name: 'Anne' }];
  const accessLog = [{ target_id: '123', action: 'READ' }];
  const pool = {
    query: async (sql) => {
      if (sql.includes('FROM members_info')) return [[student]];
      if (sql.includes('FROM student_guardian')) return [[normalizedGuardian]];
      if (sql.includes('FROM member_assigned_device_lease')) return [leases];
      if (sql.includes('FROM school_consent')) return [consents];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const loaded = loadSchoolController({ pool, accessLog });
  try {
    const res = createResponse();
    await loaded.controller.studentExport({ body: { company_id: 77, member_id: 123 } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.student, student);
    assert.equal(res.body.guardians.length, 2);
    assert.equal(res.body.guardians[0].source, 'embedded');
    assert.equal(res.body.guardians[1].source, 'normalized');
    assert.deepEqual(res.body.leases, leases);
    assert.deepEqual(res.body.consents, consents);
    assert.deepEqual(res.body.access_log, accessLog);
    assert.deepEqual(loaded.StaffActivityLog.lastQuery, { company_id: '77', target_id: '123' });
    assert.deepEqual(loaded.StaffActivityLog.lastSort, { timestamp: -1 });
    assert.equal(loaded.StaffActivityLog.lastLimit, 100);
  } finally {
    loaded.restore();
  }
});

test('studentErase anonymize mode redacts PII and preserves leases', async () => {
  const executed = [];
  const conn = {
    beginTransaction: async () => executed.push(['beginTransaction']),
    execute: async (sql, params) => {
      executed.push([sql, params]);
      if (sql.includes('UPDATE members_info')) return [{ affectedRows: 1 }];
      if (sql.includes('UPDATE guardians')) return [{ affectedRows: 2 }];
      if (sql.includes('UPDATE school_consent')) return [{ affectedRows: 3 }];
      throw new Error(`unexpected transaction statement: ${sql}`);
    },
    commit: async () => executed.push(['commit']),
    rollback: async () => executed.push(['rollback']),
    release: () => executed.push(['release']),
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
    await loaded.controller.studentErase({ body: { company_id: 77, member_id: 123 } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      ok: true,
      mode: 'anonymize',
      member_id: 123,
      receipt: {
        members_info_updated: true,
        guardians_anonymized: 2,
        consents_anonymized: 3,
        leases_preserved: 5,
      },
    });
    const sqlText = executed.map(([sql]) => String(sql)).join('\n');
    assert.match(sqlText, /first_name = 'REDACTED'/);
    assert.match(sqlText, /email = NULL/);
    assert.doesNotMatch(sqlText, /(?:UPDATE|DELETE)\s+member_assigned_device_lease/i);
  } finally {
    loaded.restore();
  }
});

test('studentErase delete mode removes guardian links, guardians, consents, and member while preserving leases', async () => {
  const executed = [];
  const conn = {
    beginTransaction: async () => executed.push(['beginTransaction']),
    execute: async (sql, params) => {
      executed.push([sql, params]);
      if (sql.includes('SELECT guardian_id FROM student_guardian')) {
        return [[{ guardian_id: 'g1' }, { guardian_id: 'g2' }]];
      }
      if (sql.includes('DELETE FROM guardians')) return [{ affectedRows: 2 }];
      if (sql.includes('DELETE FROM student_guardian')) return [{ affectedRows: 2 }];
      if (sql.includes('DELETE FROM school_consent')) return [{ affectedRows: 3 }];
      if (sql.includes('DELETE FROM members_info')) return [{ affectedRows: 1 }];
      throw new Error(`unexpected transaction statement: ${sql}`);
    },
    commit: async () => executed.push(['commit']),
    rollback: async () => executed.push(['rollback']),
    release: () => executed.push(['release']),
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
      { body: { company_id: 77, member_id: 123, mode: 'delete' } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.mode, 'delete');
    assert.deepEqual(res.body.receipt, {
      members_info_deleted: true,
      guardians_deleted: 2,
      student_guardian_links_deleted: 2,
      consents_deleted: 3,
      leases_preserved: 5,
    });
    const statements = executed.map(([sql]) => String(sql));
    assert.ok(statements.findIndex((sql) => sql.includes('DELETE FROM guardians')) < statements.findIndex((sql) => sql.includes('DELETE FROM student_guardian')));
    assert.doesNotMatch(statements.join('\n'), /(?:UPDATE|DELETE)\s+member_assigned_device_lease/i);
  } finally {
    loaded.restore();
  }
});

test('studentExport validates required ids and missing student', async () => {
  const loadedMissingCompany = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loadedMissingCompany.controller.studentExport({ body: { member_id: 123 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.msg, 'company_id is required');
  } finally {
    loadedMissingCompany.restore();
  }

  const loadedMissingMember = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loadedMissingMember.controller.studentExport({ body: { company_id: 77 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.msg, 'member_id is required');
  } finally {
    loadedMissingMember.restore();
  }

  const loadedNotFound = loadSchoolController({
    pool: { query: async () => [[]] },
  });
  try {
    const res = createResponse();
    await loadedNotFound.controller.studentExport({ body: { company_id: 77, member_id: 123 } }, res);
    assert.equal(res.statusCode, 404);
  } finally {
    loadedNotFound.restore();
  }
});

test('studentErase validates missing ids, invalid mode, and missing student', async () => {
  const loadedMissingCompany = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loadedMissingCompany.controller.studentErase({ body: { member_id: 123 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.msg, 'company_id is required');
  } finally {
    loadedMissingCompany.restore();
  }

  const loadedMissingMember = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loadedMissingMember.controller.studentErase({ body: { company_id: 77 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.msg, 'member_id is required');
  } finally {
    loadedMissingMember.restore();
  }

  const loadedInvalidMode = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loadedInvalidMode.controller.studentErase(
      { body: { company_id: 77, member_id: 123, mode: 'purge' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.msg, 'mode must be anonymize or delete');
  } finally {
    loadedInvalidMode.restore();
  }

  const loadedNotFound = loadSchoolController({
    pool: { execute: async () => [[]] },
  });
  try {
    const res = createResponse();
    await loadedNotFound.controller.studentErase(
      { body: { company_id: 77, member_id: 123, mode: 'delete' } },
      res
    );
    assert.equal(res.statusCode, 404);
  } finally {
    loadedNotFound.restore();
  }
});
