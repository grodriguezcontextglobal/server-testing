'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const controllerPath = path.resolve(__dirname, '../mysql/controllers/school.js');
const dbPath = path.resolve(__dirname, '../mysql/database/config.js');
const staffActivityLogPath = path.resolve(__dirname, '../models/StaffActivityLog.js');
const loggerPath = path.resolve(__dirname, '../helpers/logger.js');
const queuePath = path.resolve(__dirname, '../helpers/queue.js');

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

function loadSchoolController({ pool, enqueue }) {
  const originals = new Map(
    [controllerPath, dbPath, staffActivityLogPath, loggerPath, queuePath].map((modulePath) => [
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
  require.cache[loggerPath] = { exports: { error() {}, info() {} } };
  require.cache[queuePath] = { exports: { enqueue: enqueue || (async () => {}) } };
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

test('resendConsent returns 400 when company_id/member_id missing', async () => {
  const loaded = loadSchoolController({ pool: {} });
  try {
    const res = createResponse();
    await loaded.controller.resendConsent({ body: { member_id: 5 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
  } finally {
    loaded.restore();
  }
});

test('resendConsent returns 404 when no consent request exists', async () => {
  const pool = { execute: async () => [[]] };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.resendConsent({ body: { company_id: 1, member_id: 5 } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.ok, false);
  } finally {
    loaded.restore();
  }
});

test('resendConsent returns 409 when consent already agreed', async () => {
  const pool = {
    execute: async (sql) => {
      if (sql.includes('SELECT id, status, signer_name')) {
        return [[{ id: 'c1', status: 'agreed', signer_name: 'Guardian', signer_email: 'g@test.com' }]];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.resendConsent({ body: { company_id: 1, member_id: 5 } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.status, 'agreed');
  } finally {
    loaded.restore();
  }
});

test('resendConsent returns 422 when no signer_email on file', async () => {
  const pool = {
    execute: async (sql) => {
      if (sql.includes('SELECT id, status, signer_name')) {
        return [[{ id: 'c1', status: 'pending', signer_name: 'Guardian', signer_email: null }]];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.resendConsent({ body: { company_id: 1, member_id: 5 } }, res);
    assert.equal(res.statusCode, 422);
  } finally {
    loaded.restore();
  }
});

test('resendConsent regenerates OTC, updates row, and enqueues a fresh email', async () => {
  let enqueueCall = null;
  let updateParams = null;
  const pool = {
    execute: async (sql, params) => {
      if (sql.includes('SELECT id, status, signer_name')) {
        return [[{ id: 'c1', status: 'pending', signer_name: 'Guardian', signer_email: 'g@test.com' }]];
      }
      if (sql.includes('UPDATE school_consent')) {
        updateParams = params;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const enqueue = async (type, payload, opts) => {
    enqueueCall = { type, payload, opts };
  };
  const loaded = loadSchoolController({ pool, enqueue });
  try {
    const res = createResponse();
    await loaded.controller.resendConsent(
      { body: { company_id: 1, member_id: 5 }, uid: 'staff-1' },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.consent_id, 'c1');
    assert.equal(res.body.status, 'pending');
    assert.equal(res.body.guardian_email, 'g@test.com');

    // new otc, expiry, and staff id were bound to the UPDATE
    assert.equal(updateParams[3], 'c1');
    assert.equal(updateParams[2], 'staff-1');
    assert.ok(updateParams[0].length > 0);

    // a fresh email went out with a resend-specific idempotency key (distinct
    // from /consent/request's `school-consent-request:` key)
    assert.equal(enqueueCall.type, 'send-email');
    assert.equal(enqueueCall.payload.to, 'g@test.com');
    assert.match(enqueueCall.opts.idempotencyKey, /^school-consent-resend:c1:/);
  } finally {
    loaded.restore();
  }
});

test('resendConsent returns 409 if the guardian responded before the resend could apply', async () => {
  const pool = {
    execute: async (sql) => {
      if (sql.includes('SELECT id, status, signer_name')) {
        return [[{ id: 'c1', status: 'pending', signer_name: 'Guardian', signer_email: 'g@test.com' }]];
      }
      if (sql.includes('UPDATE school_consent')) {
        return [{ affectedRows: 0 }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.resendConsent({ body: { company_id: 1, member_id: 5 } }, res);
    assert.equal(res.statusCode, 409);
  } finally {
    loaded.restore();
  }
});
