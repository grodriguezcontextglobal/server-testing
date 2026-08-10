'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const { hashOtc, generateOtc } = require('../mysql/helpers/consentOtc');

const controllerPath = path.resolve(__dirname, '../mysql/controllers/school.js');
const dbPath = path.resolve(__dirname, '../mysql/database/config.js');
const staffActivityLogPath = path.resolve(__dirname, '../models/StaffActivityLog.js');
const loggerPath = path.resolve(__dirname, '../helpers/logger.js');
const queuePath = path.resolve(__dirname, '../helpers/queue.js');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
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
  require.cache[loggerPath] = { exports: { error() {}, info() {}, warn() {} } };
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

/** Pulls the ?otc=... value out of the email HTML the controller enqueued. */
function otcFromEmail(enqueuedJob) {
  const match = /[?&]otc=([A-Za-z0-9_-]+)/.exec(enqueuedJob.payload.html);
  assert.ok(match, 'the email must contain an otc query parameter');
  return match[1];
}

// ─── hashOtc ────────────────────────────────────────────────────────────────

test('hashOtc: 64 hex chars, deterministic, and not the input', () => {
  const otc = generateOtc();
  const hashed = hashOtc(otc);

  assert.match(hashed, /^[a-f0-9]{64}$/, 'must be sha256 hex');
  assert.equal(hashed, hashOtc(otc), 'must be deterministic (lookup happens BY the hash)');
  assert.notEqual(hashed, otc);
  assert.equal(hashed, crypto.createHash('sha256').update(otc).digest('hex'));
});

test('hashOtc: fits the otc column, and is length-distinguishable from plaintext', () => {
  // The backfill migration relies on exactly this to stay idempotent.
  assert.equal(hashOtc(generateOtc()).length, 64);
  assert.notEqual(generateOtc().length, 64);
});

// ─── The invariant this whole change exists for ─────────────────────────────
// The email must carry the plaintext code, the database must carry only its
// hash, and hashing what was emailed must produce what was stored. If any of
// those three drift apart, either guardians cannot use their link or the code
// is sitting in the database in the clear.

test('requestConsent: stores the hash, emails the plaintext, and the two correspond', async () => {
  const inserted = [];
  const enqueued = [];

  const pool = {
    async execute(sql, params) {
      if (/FROM members_info/.test(sql) && /minor/.test(sql)) {
        return [[{ member_id: 5, first_name: 'Ana', last_name: 'Diaz', minor: 1 }]];
      }
      if (/FROM guardians/.test(sql)) {
        return [[{ first_name: 'Rosa', last_name: 'Diaz', email: 'rosa@example.com' }]];
      }
      if (/INSERT INTO school_consent/.test(sql)) {
        inserted.push(params);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };

  const loaded = loadSchoolController({
    pool,
    enqueue: async (type, payload, opts) => { enqueued.push({ type, payload, opts }); },
  });

  try {
    const res = createResponse();
    await loaded.controller.requestConsent(
      { body: { company_id: 133, member_id: 5, guardian_id: 'g-1' }, uid: 'staff-1' },
      res
    );

    assert.equal(res.statusCode, 201);
    assert.equal(enqueued.length, 1);

    // params order in the INSERT: ..., method, otc, expires, requester
    const storedOtc = inserted[0][9];
    const emailedOtc = otcFromEmail(enqueued[0]);

    assert.match(storedOtc, /^[a-f0-9]{64}$/, 'the database must receive a hash');
    assert.notEqual(storedOtc, emailedOtc, 'the plaintext must never be stored');
    assert.equal(hashOtc(emailedOtc), storedOtc, 'hashing the emailed code must yield the stored value');
  } finally {
    loaded.restore();
  }
});

test('resendConsent: rotates to a new hash and emails the matching plaintext', async () => {
  const updates = [];
  const enqueued = [];

  const pool = {
    async execute(sql, params) {
      if (/SELECT id, status, signer_name, signer_email/.test(sql)) {
        return [[{ id: 'c-1', status: 'pending', signer_name: 'Rosa', signer_email: 'rosa@example.com' }]];
      }
      if (/UPDATE school_consent/.test(sql)) {
        updates.push(params);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };

  const loaded = loadSchoolController({
    pool,
    enqueue: async (type, payload, opts) => { enqueued.push({ type, payload, opts }); },
  });

  try {
    const res = createResponse();
    await loaded.controller.resendConsent(
      { body: { company_id: 133, member_id: 5 }, uid: 'staff-1' },
      res
    );

    assert.equal(res.statusCode, 200);

    const storedOtc = updates[0][0];
    const emailedOtc = otcFromEmail(enqueued[0]);

    assert.match(storedOtc, /^[a-f0-9]{64}$/);
    assert.notEqual(storedOtc, emailedOtc);
    assert.equal(hashOtc(emailedOtc), storedOtc);

    // The idempotency key is persisted on the Job document, so it must not
    // carry the plaintext code either.
    assert.ok(!enqueued[0].opts.idempotencyKey.includes(emailedOtc));
  } finally {
    loaded.restore();
  }
});

// ─── Lookup: client sends plaintext, server matches by hash ─────────────────

test('publicRespondConsent: looks the row up by hash, not by the plaintext it received', async () => {
  const plaintext = generateOtc();
  const seenParams = [];

  const pool = {
    async execute(sql, params) {
      if (/FROM school_consent WHERE otc/.test(sql)) {
        seenParams.push(params);
        return [[{ id: 'c-1', status: 'pending', otc: hashOtc(plaintext), otc_expires_at: new Date(Date.now() + 86400000) }]];
      }
      return [[]];
    },
  };

  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.publicRespondConsent(
      { body: { otc: plaintext, decision: 'agreed', signer_name: 'Rosa' }, get: () => 'UA', ip: '1.2.3.4' },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'agreed');
    assert.equal(seenParams[0][0], hashOtc(plaintext), 'first bound value must be the hash');
  } finally {
    loaded.restore();
  }
});

// Transitional: rows written before hashing shipped still hold plaintext. They
// must keep working until the backfill migration has run everywhere, otherwise
// every consent link already sitting in a guardian's inbox breaks.
test('publicRespondConsent: still accepts a row whose otc is stored as legacy plaintext', async () => {
  const plaintext = generateOtc();

  const pool = {
    async execute(sql, params) {
      if (/FROM school_consent WHERE otc/.test(sql)) {
        // Simulates a pre-migration row: stored value IS the plaintext.
        assert.equal(params[1], plaintext, 'the plaintext arm must still be bound');
        return [[{ id: 'c-legacy', status: 'pending', otc: plaintext, otc_expires_at: new Date(Date.now() + 86400000) }]];
      }
      return [[]];
    },
  };

  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.publicRespondConsent(
      { body: { otc: plaintext, decision: 'refused', signer_name: 'Rosa' }, get: () => 'UA', ip: '1.2.3.4' },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'refused');
  } finally {
    loaded.restore();
  }
});

test('publicRetrieveConsent: binds hash and plaintext, in that order', async () => {
  const plaintext = generateOtc();
  const seenParams = [];

  const pool = {
    async execute(sql, params) {
      if (/FROM school_consent/.test(sql)) {
        seenParams.push(params);
        return [[]]; // not found is fine; we are asserting on the lookup itself
      }
      return [[]];
    },
  };

  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.publicRetrieveConsent({ body: { otc: plaintext } }, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(seenParams[0], [hashOtc(plaintext), plaintext]);
  } finally {
    loaded.restore();
  }
});

test('an invalid otc is rejected without matching anything', async () => {
  const pool = { async execute() { return [[]]; } };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.publicRespondConsent(
      { body: { otc: 'no-existe', decision: 'agreed', signer_name: 'X' }, get: () => '', ip: '' },
      res
    );
    assert.equal(res.statusCode, 404);
  } finally {
    loaded.restore();
  }
});
