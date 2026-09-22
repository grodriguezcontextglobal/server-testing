'use strict';

// The guardian consent OTC is a bearer credential: whoever holds the plaintext
// can read a student's name, grade, DOB and guardian contact details, and can
// submit a consent decision in the guardian's name (see the note in
// mysql/helpers/consentOtc.js). The database stores only its SHA-256 hash, so
// the plaintext's one legitimate destination is the guardian's inbox.
//
// An earlier revision of this controller (still live on the unmerged branch
// `feat/school-consent-backend`) wrapped these two responses in a
// `withDebugLink(payload, link)` helper that appended `consent_url` — the
// full link, raw OTC and all — to the JSON body, gated on
// `IS_PRODUCTION = process.env.NODE_ENV === "production"`. That gate fails
// OPEN: NODE_ENV is not set on the production box, so the "development only"
// branch is the branch production takes, and the consent gate would have
// answered every caller with its own bypass token.
//
// `main` does not have that helper. These tests exist so it cannot come back
// quietly, and so the guarantee does not depend on an environment variable
// being set correctly: the assertions run with NODE_ENV unset as well as with
// NODE_ENV=production, and both must pass.

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

/** Recover the plaintext OTC from the only place it is allowed to appear. */
function otcFromEmail(enqueueCall) {
  assert.ok(enqueueCall, 'expected a consent email to be enqueued');
  const match = /\/school\/consent\/respond\?otc=([A-Za-z0-9_-]+)/.exec(enqueueCall.payload.html);
  assert.ok(match, 'expected the emailed HTML to carry a consent link');
  return match[1];
}

/**
 * The actual guarantee: no field anywhere in the response body is the OTC, a
 * link containing it, or anything else that would let a caller reconstruct it.
 * Serializing the whole body catches a leak at any nesting depth and under any
 * field name, which a fixed `assert.equal(body.consent_url, undefined)` would
 * not.
 */
function assertNoOtcLeak(body, otc) {
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes(otc), `response body leaked the raw OTC: ${serialized}`);
  assert.ok(
    !/consent\/respond\?otc=/.test(serialized),
    `response body leaked a consent link: ${serialized}`
  );
  assert.equal(body.consent_url, undefined, 'consent_url must never be returned');
  assert.equal(body.otc, undefined, 'otc must never be returned');
  assert.equal(body.link, undefined, 'link must never be returned');
}

/** Run one case under an explicit NODE_ENV, restoring whatever was there. */
async function withNodeEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'NODE_ENV');
  const previous = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    await fn();
  } finally {
    if (had) process.env.NODE_ENV = previous;
    else delete process.env.NODE_ENV;
  }
}

// NODE_ENV is deliberately absent from the production box's environment today;
// `undefined` is therefore the case that actually reflects production.
const ENVIRONMENTS = [undefined, 'production', 'development'];

function requestConsentPool() {
  return {
    execute: async (sql) => {
      if (sql.includes('FROM members_info') && sql.includes('minor')) {
        return [[{ member_id: 5, first_name: 'Ada', last_name: 'Lovelace', minor: 1 }]];
      }
      if (sql.includes('FROM student_guardian')) {
        return [[{ id: 'g1', first_name: 'Anne', last_name: 'Byron', email: 'guardian@example.com' }]];
      }
      if (sql.includes('INSERT INTO school_consent')) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function resendConsentPool() {
  return {
    execute: async (sql) => {
      if (sql.includes('SELECT id, status, signer_name')) {
        return [[{ id: 'c1', status: 'pending', signer_name: 'Anne Byron', signer_email: 'guardian@example.com' }]];
      }
      if (sql.includes('UPDATE school_consent')) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

for (const env of ENVIRONMENTS) {
  const label = env === undefined ? 'NODE_ENV unset (production today)' : `NODE_ENV=${env}`;

  test(`requestConsent never returns the consent link — ${label}`, async () => {
    await withNodeEnv(env, async () => {
      let enqueueCall = null;
      const loaded = loadSchoolController({
        pool: requestConsentPool(),
        enqueue: async (type, payload, opts) => {
          enqueueCall = { type, payload, opts };
        },
      });
      try {
        const res = createResponse();
        await loaded.controller.requestConsent(
          { body: { company_id: 1, member_id: 5 }, uid: 'staff-1' },
          res
        );

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.ok, true);
        assertNoOtcLeak(res.body, otcFromEmail(enqueueCall));
      } finally {
        loaded.restore();
      }
    });
  });

  test(`resendConsent never returns the consent link — ${label}`, async () => {
    await withNodeEnv(env, async () => {
      let enqueueCall = null;
      const loaded = loadSchoolController({
        pool: resendConsentPool(),
        enqueue: async (type, payload, opts) => {
          enqueueCall = { type, payload, opts };
        },
      });
      try {
        const res = createResponse();
        await loaded.controller.resendConsent(
          { body: { company_id: 1, member_id: 5 }, uid: 'staff-1' },
          res
        );

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
        assertNoOtcLeak(res.body, otcFromEmail(enqueueCall));
      } finally {
        loaded.restore();
      }
    });
  });
}

// The helper itself must stay absent. A reviewer pulling the stale branch's
// school.js forward would otherwise reintroduce the leak without touching any
// of the assertions above, since `withDebugLink` reads NODE_ENV at module load
// and the tests above set it per-case.
test('school.js does not contain a NODE_ENV-gated debug-link helper', () => {
  const source = require('node:fs').readFileSync(controllerPath, 'utf8');
  assert.ok(!/withDebugLink/.test(source), 'withDebugLink must not be reintroduced');
  assert.ok(
    !/consent_url/.test(source),
    'school.js must not build a consent_url field into any response'
  );
});
