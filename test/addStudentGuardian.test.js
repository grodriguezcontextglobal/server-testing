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

// --- Validation tests ---

test('addStudentGuardian returns 400 when company_id is missing', async () => {
  const loaded = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loaded.controller.addStudentGuardian(
      { body: { member_id: 100, first_name: 'Jane', email: 'jane@test.com' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.msg, /company_id/i);
  } finally {
    loaded.restore();
  }
});

test('addStudentGuardian returns 400 when member_id is missing', async () => {
  const loaded = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loaded.controller.addStudentGuardian(
      { body: { company_id: 77, first_name: 'Jane', email: 'jane@test.com' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.msg, /member_id/i);
  } finally {
    loaded.restore();
  }
});

test('addStudentGuardian returns 400 when no guardian_id and no identity fields', async () => {
  const loaded = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loaded.controller.addStudentGuardian(
      { body: { company_id: 77, member_id: 100, relationship: 'mother' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.msg, /guardian_id|name|email/i);
  } finally {
    loaded.restore();
  }
});

test('addStudentGuardian returns 404 when student not found', async () => {
  const pool = {
    execute: async () => [[]],
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.addStudentGuardian(
      { body: { company_id: 77, member_id: 100, first_name: 'Jane', email: 'jane@test.com' } },
      res
    );
    assert.equal(res.statusCode, 404);
    assert.match(res.body.msg, /member not found/i);
  } finally {
    loaded.restore();
  }
});

// --- Create new guardian (no guardian_id) ---

test('addStudentGuardian creates new guardian and links to student', async () => {
  const executed = [];
  const conn = {
    beginTransaction: async () => executed.push(['beginTransaction']),
    execute: async (sql, params) => {
      executed.push([sql, params]);
      if (sql.includes('SELECT id FROM guardians WHERE id')) return [[]]; // no existing guardian
      if (sql.includes('SELECT id FROM student_guardian WHERE')) return [[]]; // no existing link
      if (sql.includes('INSERT INTO guardians')) return [{}];
      if (sql.includes('INSERT INTO student_guardian')) return [{}];
      throw new Error(`unexpected: ${sql}`);
    },
    commit: async () => executed.push(['commit']),
    rollback: async () => executed.push(['rollback']),
    release: () => executed.push(['release']),
  };
  const pool = {
    execute: async (sql) => {
      if (sql.includes('SELECT 1 FROM members_info')) return [[{ 1: 1 }]];
      throw new Error(`unexpected pool: ${sql}`);
    },
    getConnection: async () => conn,
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.addStudentGuardian(
      { body: { company_id: 77, member_id: 100, first_name: 'Jane', email: 'jane@test.com', relationship: 'mother' } },
      res
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.linked, true);
    assert.equal(res.body.created_guardian, true);
    assert.equal(res.body.existing_link, false);
    assert.ok(res.body.guardian_id);
  } finally {
    loaded.restore();
  }
});

// --- Reuse existing guardian (with guardian_id) ---

test('addStudentGuardian reuses existing guardian and creates link', async () => {
  const executed = [];
  const conn = {
    beginTransaction: async () => executed.push(['beginTransaction']),
    execute: async (sql, params) => {
      executed.push([sql, params]);
      if (sql.includes('SELECT id FROM guardians WHERE id')) return [[{ id: 'g-existing' }]];
      if (sql.includes('SELECT id FROM student_guardian WHERE')) return [[]]; // no existing link
      if (sql.includes('INSERT INTO student_guardian')) return [{}];
      throw new Error(`unexpected: ${sql}`);
    },
    commit: async () => executed.push(['commit']),
    rollback: async () => executed.push(['rollback']),
    release: () => executed.push(['release']),
  };
  const pool = {
    execute: async (sql) => {
      if (sql.includes('SELECT 1 FROM members_info')) return [[{ 1: 1 }]];
      throw new Error(`unexpected pool: ${sql}`);
    },
    getConnection: async () => conn,
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.addStudentGuardian(
      { body: { company_id: 77, member_id: 100, guardian_id: 'g-existing', relationship: 'father' } },
      res
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.guardian_id, 'g-existing');
    assert.equal(res.body.linked, true);
    assert.equal(res.body.created_guardian, false);
  } finally {
    loaded.restore();
  }
});

// --- Idempotent: link already exists ---

test('addStudentGuardian returns 200 when link already exists', async () => {
  const executed = [];
  const conn = {
    beginTransaction: async () => executed.push(['beginTransaction']),
    execute: async (sql, params) => {
      executed.push([sql, params]);
      if (sql.includes('SELECT id FROM guardians WHERE id')) return [[{ id: 'g-existing' }]];
      if (sql.includes('SELECT id FROM student_guardian WHERE')) return [[{ id: 'link-1' }]];
      throw new Error(`unexpected: ${sql}`);
    },
    commit: async () => executed.push(['commit']),
    rollback: async () => executed.push(['rollback']),
    release: () => executed.push(['release']),
  };
  const pool = {
    execute: async (sql) => {
      if (sql.includes('SELECT 1 FROM members_info')) return [[{ 1: 1 }]];
      throw new Error(`unexpected pool: ${sql}`);
    },
    getConnection: async () => conn,
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.addStudentGuardian(
      { body: { company_id: 77, member_id: 100, guardian_id: 'g-existing', relationship: 'father' } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.linked, false);
    assert.equal(res.body.existing_link, true);
    assert.equal(res.body.created_guardian, false);
    // Should NOT have called INSERT INTO student_guardian
    const sqls = executed.map(([sql]) => String(sql));
    assert.ok(!sqls.some((s) => s.includes('INSERT INTO student_guardian')));
  } finally {
    loaded.restore();
  }
});

// --- Guardian not found in company ---

test('addStudentGuardian returns 404 when guardian_id not found in company', async () => {
  const executed = [];
  const conn = {
    beginTransaction: async () => executed.push(['beginTransaction']),
    execute: async (sql, params) => {
      executed.push([sql, params]);
      if (sql.includes('SELECT id FROM guardians WHERE id')) return [[]]; // not found
      throw new Error(`unexpected: ${sql}`);
    },
    commit: async () => executed.push(['commit']),
    rollback: async () => executed.push(['rollback']),
    release: () => executed.push(['release']),
  };
  const pool = {
    execute: async (sql) => {
      if (sql.includes('SELECT 1 FROM members_info')) return [[{ 1: 1 }]];
      throw new Error(`unexpected pool: ${sql}`);
    },
    getConnection: async () => conn,
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.addStudentGuardian(
      { body: { company_id: 77, member_id: 100, guardian_id: 'g-nonexistent' } },
      res
    );
    assert.equal(res.statusCode, 404);
    assert.match(res.body.msg, /guardian not found/i);
    // Should have rolled back
    assert.ok(executed.some(([op]) => op === 'rollback'));
  } finally {
    loaded.restore();
  }
});

// --- Guardian from wrong company ---

test('addStudentGuardian returns 404 when guardian belongs to different company', async () => {
  const executed = [];
  const conn = {
    beginTransaction: async () => executed.push(['beginTransaction']),
    execute: async (sql, params) => {
      executed.push([sql, params]);
      // Guardian exists but in different company — the query scopes by company_id
      if (sql.includes('SELECT id FROM guardians WHERE id')) return [[]];
      throw new Error(`unexpected: ${sql}`);
    },
    commit: async () => executed.push(['commit']),
    rollback: async () => executed.push(['rollback']),
    release: () => executed.push(['release']),
  };
  const pool = {
    execute: async (sql) => {
      if (sql.includes('SELECT 1 FROM members_info')) return [[{ 1: 1 }]];
      throw new Error(`unexpected pool: ${sql}`);
    },
    getConnection: async () => conn,
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.addStudentGuardian(
      { body: { company_id: 77, member_id: 100, guardian_id: 'g-other-company' } },
      res
    );
    assert.equal(res.statusCode, 404);
  } finally {
    loaded.restore();
  }
});
