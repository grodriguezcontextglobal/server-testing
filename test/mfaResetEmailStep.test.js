'use strict';

/**
 * FedRAMP A5, paso del correo tras un reset de MFA (2026-11-03). Contrato:
 * reports/BACKEND_fedramp_a5_reset_email_step_REPLY_2026-10-30.md.
 *
 *   - /mfa/reset/:id marca la cuenta (mfaResetPending) y encola el correo de
 *     reset de contraseña; responde resetEmailSent.
 *   - Con la marca, el login con la contraseña correcta responde 403
 *     mfaResetEmailRequired SIN mfaSetupToken (también con MFA_REQUIRED=false).
 *   - Un update-password correcto limpia la marca.
 *   - reset-admin-password: 3 correos por cuenta y hora como mucho.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const speakeasy = require('speakeasy');

const U_TARGET = '222222222222222222222222';
const U_ADMIN = '555555555555555555555555';
const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';

let users, activity, queued, enqueueFails, redisCounters;

function makeUser(id, email, extra) {
  return { id, _id: id, name: 'N', email, password: 'hash-ok', tokenVersion: 0, active: true, ...extra };
}
function reset() {
  users = {
    [U_TARGET]: makeUser(U_TARGET, 'target@x.com', { mfaEnabled: true, mfaSecret: { base32: speakeasy.generateSecret().base32 } }),
    [U_ADMIN]: makeUser(U_ADMIN, 'admin@x.com', { mfaEnabled: true }),
  };
  activity = [];
  queued = [];
  enqueueFails = false;
  redisCounters = {};
  delete process.env.MFA_REQUIRED;
}

const query = (val) => {
  const p = Promise.resolve(val);
  p.select = () => query(val);
  p.lean = () => Promise.resolve(val);
  return p;
};
const match = (u, filter) => Object.entries(filter).every(([k, v]) => String(u[k === '_id' ? 'id' : k]) === String(v));
const apply = (u, update) => {
  if (update.$set) Object.assign(u, update.$set);
  for (const k of Object.keys(update.$unset || {})) delete u[k];
  if (update.$inc) u.tokenVersion += update.$inc.tokenVersion;
};
const AdminUserStub = {
  findOne: (filter) => query(Object.values(users).find((u) => match(u, filter)) ?? null),
  findById: (id) => query(users[id] ?? null),
  updateOne: async (filter, update) => { apply(users[filter._id], update); return { modifiedCount: 1 }; },
  findByIdAndUpdate: async (id, update) => { apply(users[id], update); return users[id]; },
};

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const stubPkg = (name, exports) => {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const noop = () => {};

stub('models/AdminUser.js', AdminUserStub);
stub('models/Company.js', { exists: async () => null });
stub('models/StripeTransaction.js', {});
stub('helpers/jwt.js', { generateJWT: async (uid) => `session-token::${uid}`, SESSION_MAX_SECONDS: 43200 });
stub('helpers/logger.js', { warn: noop, error: noop, info: noop });
stub('helpers/companyContext.js', { resolveCompanyContext: (r) => r.headers?.['x-company-id'] ?? null });
stub('helpers/companyMembership.js', {
  findCompanyMembership: async (companyId, user) =>
    ({ 'target@x.com': { roleType: 'assistant' }, 'admin@x.com': { roleType: 'admin' } })[user.email] ?? null,
});
stub('helpers/queue.js', {
  enqueue: async (type, payload) => {
    if (enqueueFails) throw new Error('queue down');
    queued.push({ type, payload });
    return { id: 'job1' };
  },
});
stub('mysql/database/config.js', () => ({ execute: async () => [[{ staff_id: 7 }]] }));
stub('nodeMailer/notifications.js', {
  loginActivityNotification: async () => ({ success: true }),
  buildLinkToResetPasswordMessage: (body) => ({ to: body.contactInfo.email, html: body.linkToResetPassword }),
});
stub('controller/staffActivityLog.js', { logStaffActivity: async (e) => { activity.push(e); } });
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => ({
    set: async () => 'OK',
    get: async () => null,
    del: async () => 1,
    incr: async (k) => (redisCounters[k] = (redisCounters[k] || 0) + 1),
    expire: async () => 1,
  }),
});
stubPkg('bcrypt', { compare: async (pw, hash) => `hash-${pw}` === hash, genSalt: async () => 's', hash: async (pw) => `hash-${pw}` });

const { loginUser, resetUserMfa, updatePassword, attachPasswordResetLink } = require('../controller/admin');
const { generatePasswordResetToken } = require('../helpers/passwordResetToken');

beforeEach(reset);

function res() {
  return {
    code: 200,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    set() {},
    cookie() {},
  };
}
const resetReq = () => ({ params: { id: U_TARGET }, uid: U_ADMIN, headers: { 'x-company-id': COMPANY }, ip: '1.1.1.1' });

test('reset: marca la cuenta, encola el correo con el enlace firmado y lo registra', async () => {
  const r = res();
  await resetUserMfa(resetReq(), r);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.resetEmailSent, true);
  assert.equal(users[U_TARGET].mfaResetPending, true);
  assert.equal(users[U_TARGET].mfaEnabled, false);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].type, 'send-email');
  assert.equal(queued[0].payload.to, 'target@x.com');
  assert.match(queued[0].payload.html, /\/reset-password\?token=[^&]+&uid=222222222222222222222222/);
  assert.deepEqual(activity.map((a) => a.action), ['MFA_RESET', 'MFA_RESET_EMAIL_SENT']);
});

test('reset con la cola caída: el reset se hace igual y resetEmailSent es false', async () => {
  enqueueFails = true;
  const r = res();
  await resetUserMfa(resetReq(), r);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.resetEmailSent, false);
  assert.equal(users[U_TARGET].mfaResetPending, true);
  assert.deepEqual(activity.map((a) => a.action), ['MFA_RESET']);
});

test('login con la marca y la contraseña correcta: 403 mfaResetEmailRequired, sin mfaSetupToken', async () => {
  await resetUserMfa(resetReq(), res());
  for (const required of [undefined, 'false']) {
    if (required) process.env.MFA_REQUIRED = required;
    const r = res();
    await loginUser({ body: { email: 'target@x.com', password: 'ok' }, headers: {}, ip: '1.1.1.1' }, r);
    assert.equal(r.code, 403);
    assert.equal(r.body.mfaResetEmailRequired, true);
    assert.equal(r.body.mfaSetupRequired, true);
    assert.equal(r.body.mfaSetupToken, undefined);
    assert.equal(r.body.token, undefined);
  }
  assert.equal(queued.length, 1, 'el login no reenvía el correo');
});

test('login con la marca y la contraseña incorrecta: 400 como siempre', async () => {
  await resetUserMfa(resetReq(), res());
  const r = res();
  await loginUser({ body: { email: 'target@x.com', password: 'wrong' }, headers: {}, ip: '1.1.1.1' }, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.mfaResetEmailRequired, undefined);
});

test('update-password correcto con el enlace limpia la marca y lo registra', async () => {
  await resetUserMfa(resetReq(), res());
  // La persona se enroló desde el enlace (mfa/generate + verify).
  const secret = speakeasy.generateSecret().base32;
  Object.assign(users[U_TARGET], { mfaEnabled: true, mfaSecret: { base32: secret } });
  const resetToken = await generatePasswordResetToken(users[U_TARGET]);
  const mfaCode = speakeasy.totp({ secret, encoding: 'base32' });

  const r = res();
  await updatePassword({ body: { resetToken, password: 'A-new-passw0rd!', mfaCode }, headers: {}, ip: '1.1.1.1' }, r);
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.equal(users[U_TARGET].mfaResetPending, false);
  assert.equal(activity.at(-1).action, 'MFA_RESET_COMPLETED');

  const login = res();
  await loginUser({ body: { email: 'target@x.com', password: 'A-new-passw0rd!' }, headers: {}, ip: '1.1.1.1' }, login);
  assert.equal(login.body.mfaResetEmailRequired, undefined);
});

test('reset-admin-password: como mucho 3 correos por cuenta y hora, siempre 202', async () => {
  let sent = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = res();
    let passed = false;
    await attachPasswordResetLink({ body: { contactInfo: { email: 'target@x.com' } }, headers: {} }, r, () => { passed = true; });
    if (passed) sent += 1;
    else assert.equal(r.code, 202);
  }
  assert.equal(sent, 3);
});

test('reset-admin-password con la marca: el reenvío queda registrado', async () => {
  users[U_TARGET].mfaResetPending = true;
  const req = { body: { contactInfo: { email: 'target@x.com' } }, headers: {}, ip: '1.1.1.1' };
  let passed = false;
  await attachPasswordResetLink(req, res(), () => { passed = true; });
  assert.equal(passed, true);
  assert.match(req.body.linkToResetPassword, /\/reset-password\?token=/);
  assert.equal(activity.at(-1).action, 'MFA_RESET_EMAIL_SENT');
  assert.equal(activity.at(-1).details.resend, true);
});
