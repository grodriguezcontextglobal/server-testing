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

function loadSchoolController({ pool }) {
  const originals = new Map(
    [controllerPath, dbPath, staffActivityLogPath, loggerPath].map((modulePath) => [
      modulePath,
      require.cache[modulePath],
    ])
  );

  const StaffActivityLog = {
    find() {
      return { sort() { return { limit() { return { lean: async () => [] }; } }; } };
    },
  };

  delete require.cache[controllerPath];
  require.cache[dbPath] = { exports: () => pool };
  require.cache[staffActivityLogPath] = { exports: StaffActivityLog };
  require.cache[loggerPath] = { exports: { error() {} } };
  const controller = require(controllerPath);

  return {
    controller,
    restore() {
      for (const [modulePath, cachedModule] of originals) {
        if (cachedModule) require.cache[modulePath] = cachedModule;
        else delete require.cache[modulePath];
      }
    },
  };
}

test('searchGuardians returns 400 when company_id is missing', async () => {
  const loaded = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loaded.controller.searchGuardians({ body: { email: 'test@example.com' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.msg, /company_id/i);
  } finally {
    loaded.restore();
  }
});

test('searchGuardians returns 400 when no search factor is provided', async () => {
  const loaded = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loaded.controller.searchGuardians({ body: { company_id: 77 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.msg, /member_id|email|guardian_id/i);
  } finally {
    loaded.restore();
  }
});

test('searchGuardians returns empty array for non-matching email', async () => {
  const pool = {
    execute: async () => [[]],
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.searchGuardians(
      { body: { company_id: 77, email: 'nonexistent@example.com' } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.count, 0);
    assert.deepEqual(res.body.guardians, []);
  } finally {
    loaded.restore();
  }
});

test('searchGuardians searches by email (case-insensitive)', async () => {
  const pool = {
    execute: async (sql, params) => {
      if (sql.includes('FROM guardians g')) {
        return [[{
          id: 'g1',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane.doe@test.com',
          phone_number: '555-0100',
          member_id: 100,
          relationship: 'mother',
          is_primary: 1,
          student_first_name: 'Student',
          student_last_name: 'A',
        }]];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.searchGuardians(
      { body: { company_id: 77, email: 'jane.doe@test.com' } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.guardians[0].id, 'g1');
    assert.equal(res.body.guardians[0].first_name, 'Jane');
    assert.equal(res.body.guardians[0].students.length, 1);
    assert.equal(res.body.guardians[0].students[0].member_id, 100);
  } finally {
    loaded.restore();
  }
});

test('searchGuardians searches by guardian_id', async () => {
  const pool = {
    execute: async (sql, params) => {
      if (sql.includes('FROM guardians g')) {
        return [[{
          id: 'g-search',
          first_name: 'Search',
          last_name: 'Guardian',
          email: 'search@test.com',
          phone_number: null,
          member_id: 200,
          relationship: 'father',
          is_primary: 0,
          student_first_name: 'Kid',
          student_last_name: 'B',
        }]];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.searchGuardians(
      { body: { company_id: 77, guardian_id: 'g-search' } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.guardians[0].id, 'g-search');
  } finally {
    loaded.restore();
  }
});

test('searchGuardians searches by member_id', async () => {
  const pool = {
    execute: async (sql, params) => {
      if (sql.includes('FROM guardians g')) {
        return [[{
          id: 'g-m',
          first_name: 'Member',
          last_name: 'Parent',
          email: 'member@test.com',
          phone_number: null,
          member_id: 300,
          relationship: 'parent',
          is_primary: 1,
          student_first_name: 'Child',
          student_last_name: 'C',
        }]];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.searchGuardians(
      { body: { company_id: 77, member_id: 300 } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.guardians[0].students[0].member_id, 300);
  } finally {
    loaded.restore();
  }
});

test('searchGuardians groups shared guardians with multiple students', async () => {
  const pool = {
    execute: async (sql, params) => {
      if (sql.includes('FROM guardians g')) {
        return [[
          {
            id: 'g-shared',
            first_name: 'Shared',
            last_name: 'Parent',
            email: 'shared@test.com',
            phone_number: null,
            member_id: 400,
            relationship: 'parent',
            is_primary: 1,
            student_first_name: 'Student',
            student_last_name: 'X',
          },
          {
            id: 'g-shared',
            first_name: 'Shared',
            last_name: 'Parent',
            email: 'shared@test.com',
            phone_number: null,
            member_id: 401,
            relationship: 'parent',
            is_primary: 0,
            student_first_name: 'Student',
            student_last_name: 'Y',
          },
        ]];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.searchGuardians(
      { body: { company_id: 77, email: 'shared@test.com' } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 1); // grouped into one guardian
    assert.equal(res.body.guardians[0].students.length, 2);
    assert.equal(res.body.guardians[0].students[0].member_id, 400);
    assert.equal(res.body.guardians[0].students[1].member_id, 401);
  } finally {
    loaded.restore();
  }
});

test('searchGuardians does not leak guardians from other companies', async () => {
  const pool = {
    execute: async () => [[]],
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.searchGuardians(
      { body: { company_id: 99999, email: 'anyone@test.com' } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 0);
  } finally {
    loaded.restore();
  }
});
