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

// The transitional plaintext arm was removed 2026-08-17, once the backfill had
// run on prod and every stored value was a hash. Only the hash may be bound —
// binding the raw token again would let a leaked column value be replayed as a
// consent link, which is the whole point of hashing it.
test('publicRespondConsent: binds only the hash, never the raw token', async () => {
  const plaintext = generateOtc();
  const seenParams = [];

  const pool = {
    async execute(sql, params) {
      if (/FROM school_consent WHERE otc/.test(sql)) {
        seenParams.push(params);
        return [[]];
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

    assert.equal(res.statusCode, 404);
    assert.deepEqual(seenParams[0], [hashOtc(plaintext)]);
  } finally {
    loaded.restore();
  }
});

test('publicRetrieveConsent: binds only the hash', async () => {
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
    assert.deepEqual(seenParams[0], [hashOtc(plaintext)]);
  } finally {
    loaded.restore();
  }
});

// Regression: requestConsent's third guardian-resolution tier (embedded
// parent_guardian_* on members_info) never populates guardian_id — there is no
// `guardians` row to point at. That left school_consent.guardian_id NULL, and
// publicRetrieveConsent's guardians JOIN was INNER, so a perfectly valid,
// unexpired, matched-by-hash row was silently dropped and reported as
// "Invalid consent link." The fix is a LEFT JOIN; the response already falls
// back to signer_name/signer_email when the guardian columns come back NULL.
test('publicRetrieveConsent: a consent with no normalized guardian (guardian_id NULL) still resolves', async () => {
  const plaintext = generateOtc();

  const pool = {
    async execute(sql) {
      if (/FROM school_consent AS sc/.test(sql)) {
        return [[{
          consent_id: 'c-embedded',
          company_id: 147,
          member_id: 664,
          guardian_id: null,
          policy_type: 'AUP',
          policy_version: '1',
          signer_name: 'Carlos Martinez',
          signer_email: 'jdow3@invoxia.cc',
          method: 'email-link',
          consented_at: null,
          created_at: new Date(),
          status: 'pending',
          otc_expires_at: new Date(Date.now() + 86400000),
          requested_at: new Date(),
          responded_at: null,
          refused_at: null,
          effective_otc_expires_at: new Date(Date.now() + 86400000),
          company_name: 'Bridges Academy',
          industry: 'education',
          consent_document_id: null,
          student_first_name: 'Ana',
          student_last_name: 'Diaz',
          student_email: null,
          student_grade: '5',
          student_homeroom: null,
          student_date_of_birth: null,
          // the guardians LEFT JOIN found no row — all four come back NULL
          guardian_first_name: null,
          guardian_last_name: null,
          guardian_email: null,
          guardian_phone_number: null,
        }]];
      }
      return [[]];
    },
  };

  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.publicRetrieveConsent({ body: { otc: plaintext } }, res);

    assert.equal(res.statusCode, 200, 'a matched, unexpired row must not 404');
    assert.equal(res.body.ok, true);
    // falls back to signer_name/signer_email captured at request time
    assert.equal(res.body.guardian.full_name, 'Carlos Martinez');
    assert.equal(res.body.guardian.email, 'jdow3@invoxia.cc');
    assert.equal(res.body.student.full_name, 'Ana Diaz');
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
