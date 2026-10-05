'use strict';

/**
 * MFA obligatoria para AdminUser.
 *
 *   - Login de una cuenta sin MFA: NO hay token de sesión ni se abre sesión; se
 *     devuelve un token de enrolamiento (mfaSetupToken) que solo sirve para
 *     /mfa/generate y /mfa/verify.
 *   - El token de enrolamiento no lo acepta validateJWT (otro secreto).
 *   - Alta, renovación y /mfa/disable no pueden saltarse la obligación.
 *   - MFA_REQUIRED=false devuelve el comportamiento anterior.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');

// ── stubs ───────────────────────────────────────────────────────────────────
const U_OFF = '111111111111111111111111';
const U_ON = '222222222222222222222222';
const U_ON_NOSECRET = '333333333333333333333333';

let users, redisCalls, created;

function makeUser(id, email, extra) {
  const u = { id, name: 'N', email, password: 'ok', tokenVersion: 0, active: true, ...extra };
  u.save = async () => u;
  return u;
}
function reset() {
  const secret = speakeasy.generateSecret();
  users = {
    [U_OFF]: makeUser(U_OFF, 'off@x.com', { mfaEnabled: false }),
    [U_ON]: makeUser(U_ON, 'on@x.com', { mfaEnabled: true, mfaSecret: { base32: secret.base32 } }),
    [U_ON_NOSECRET]: makeUser(U_ON_NOSECRET, 'nosecret@x.com', { mfaEnabled: true }),
  };
  redisCalls = [];
  created = [];
  delete process.env.MFA_REQUIRED;
}

const query = (val) => {
  const p = Promise.resolve(val);
  p.select = () => query(val);
  p.lean = () => Promise.resolve(val);
  return p;
};
function AdminUserStub(data) {
  Object.assign(this, data);
  this.id = '444444444444444444444444';
  this.tokenVersion = 0;
  this.save = async () => { created.push(this); };
}
AdminUserStub.findOne = async ({ email }) => Object.values(users).find((u) => u.email === email) ?? null;
AdminUserStub.findById = (id) => query(users[id] ?? null);

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
stub('models/StripeTransaction.js', {});
stub('helpers/jwt.js', { generateJWT: async (uid) => `session-token::${uid}` });
stub('helpers/logger.js', { warn: noop, error: noop, info: noop });
stub('mysql/database/config.js', () => ({ execute: async () => [[{ staff_id: 7 }]] }));
stub('nodeMailer/notifications.js', { loginActivityNotification: async () => ({ success: true }) });
stub('controller/staffActivityLog.js', { logStaffActivity: async () => {} });
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => ({
    set: async (...a) => { redisCalls.push(['set', a[0]]); return 'OK'; },
    get: async () => null,
    del: async (k) => { redisCalls.push(['del', k]); return 1; },
  }),
});
stubPkg('bcrypt', {
  compare: async (pw, hash) => pw === hash,
  genSalt: async () => 's',
  hash: async (pw) => pw,
});
stubPkg('qrcode', { toDataURL: (url, cb) => cb(null, 'data:image/png;base64,QR') });

const {
  loginUser, createAdminUser, renewToken, generateMfaSecret, verifyMfaSetup, disableMfa,
} = require('../controller/admin');
const { validateJWT } = require('../middlewares/validate-jwt');
const { validateMfaEnrollment } = require('../middlewares/validateMfaEnrollment');
const { verifyMfaSetupToken } = require('../helpers/mfaSetupToken');

beforeEach(reset);
afterEach(() => { delete process.env.MFA_REQUIRED; });

function req(body = {}, headers = {}, extra = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { body, headers: h, ip: '127.0.0.1', header: (n) => h[n.toLowerCase()], ...extra };
}
function res() {
  const r = { cookies: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; if (r.code === undefined) r.code = 200; return r; };
  r.cookie = (n, v) => { r.cookies[n] = v; return r; };
  return r;
}
const totp = (u) => speakeasy.totp({ secret: u.mfaSecret.base32, encoding: 'base32' });

// ═══ login ══════════════════════════════════════════════════════════════════

test('login sin MFA: 403 con token de enrolamiento, sin token de sesión y sin abrir sesión', async () => {
  const r = res();
  await loginUser(req({ email: 'off@x.com', password: 'ok' }), r);
  assert.equal(r.code, 403);
  assert.equal(r.body.mfaSetupRequired, true);
  assert.equal(r.body.token, undefined);
  assert.equal(verifyMfaSetupToken(r.body.mfaSetupToken), U_OFF);
  assert.deepEqual(redisCalls, [], 'no debe reclamar la sesión en Redis');
});

test('login sin MFA y contraseña incorrecta: 400, no hay token de enrolamiento', async () => {
  const r = res();
  await loginUser(req({ email: 'off@x.com', password: 'mal' }), r);
  assert.equal(r.code, 400);
  assert.equal(r.body.mfaSetupToken, undefined);
});

test('login con MFA y sin código: 403 mfaRequired (como antes)', async () => {
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok' }), r);
  assert.equal(r.code, 403);
  assert.equal(r.body.mfaRequired, true);
  assert.equal(r.body.mfaSetupToken, undefined);
});

test('login con MFA y código válido: 200 con token de sesión', async () => {
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', mfaCode: totp(users[U_ON]) }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.token, `session-token::${U_ON}`);
});

test('login con mfaEnabled pero sin secreto guardado: se trata como sin MFA (enrolamiento, no 500)', async () => {
  const r = res();
  await loginUser(req({ email: 'nosecret@x.com', password: 'ok' }), r);
  assert.equal(r.code, 403);
  assert.equal(r.body.mfaSetupRequired, true);
});

test('MFA_REQUIRED=false: la cuenta sin MFA recibe token como antes', async () => {
  process.env.MFA_REQUIRED = 'false';
  const r = res();
  await loginUser(req({ email: 'off@x.com', password: 'ok' }), r);
  assert.equal(r.code, 200);
  assert.ok(r.body.token);
});

// ═══ aislamiento del token de enrolamiento ══════════════════════════════════

test('validateJWT rechaza el token de enrolamiento', async () => {
  const r = res();
  await loginUser(req({ email: 'off@x.com', password: 'ok' }), r);
  const out = res();
  let nextCalled = false;
  validateJWT(req({}, { 'x-token': r.body.mfaSetupToken }), out, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(out.code, 401);
});

test('validateMfaEnrollment acepta el token de enrolamiento y marca la petición', async () => {
  const r = res();
  await loginUser(req({ email: 'off@x.com', password: 'ok' }), r);
  const q = req({}, { 'x-mfa-setup-token': r.body.mfaSetupToken });
  let nextCalled = false;
  validateMfaEnrollment(q, res(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(q.uid, U_OFF);
  assert.equal(q.mfaSetup, true);
});

test('validateMfaEnrollment rechaza un token de sesión puesto como token de enrolamiento', () => {
  const sessionToken = jwt.sign({ uid: U_OFF, tokenVersion: 0 }, process.env.SECRET_JWT_SEED);
  const out = res();
  let nextCalled = false;
  validateMfaEnrollment(req({}, { 'x-mfa-setup-token': sessionToken }), out, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(out.code, 401);
});

test('validateMfaEnrollment sin token de enrolamiento sigue aceptando un JWT de sesión', () => {
  const sessionToken = jwt.sign({ uid: U_ON, tokenVersion: 0 }, process.env.SECRET_JWT_SEED);
  const q = req({}, { 'x-token': sessionToken });
  let nextCalled = false;
  validateMfaEnrollment(q, res(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(q.mfaSetup, undefined);
});

// ═══ enrolamiento ═══════════════════════════════════════════════════════════

test('enrolamiento completo: generate + verify con el token de enrolamiento activa la MFA y pide re-login', async () => {
  const g = res();
  await generateMfaSecret({ uid: U_OFF, mfaSetup: true }, g);
  assert.equal(g.code, 200);
  assert.ok(g.body.qrCode);
  const u = users[U_OFF];
  assert.ok(u.mfaSecret?.base32, 'el secreto debe quedar guardado');

  const v = res();
  await verifyMfaSetup({ uid: U_OFF, mfaSetup: true, body: { token: totp(u) } }, v);
  assert.equal(v.code, 200);
  assert.equal(u.mfaEnabled, true);
  assert.equal(v.body.reloginRequired, true);
  assert.equal(v.body.token, undefined, 'verify no emite sesión');

  const l = res();
  await loginUser(req({ email: 'off@x.com', password: 'ok', mfaCode: totp(u) }), l);
  assert.equal(l.code, 200);
  assert.ok(l.body.token);
});

test('generate no sobrescribe el secreto de una cuenta que ya tiene MFA (409)', async () => {
  const before = users[U_ON].mfaSecret.base32;
  const r = res();
  await generateMfaSecret({ uid: U_ON }, r);
  assert.equal(r.code, 409);
  assert.equal(users[U_ON].mfaSecret.base32, before);
});

test('verify sin secreto generado: 400, no 500', async () => {
  const r = res();
  await verifyMfaSetup({ uid: U_OFF, body: { token: '123456' } }, r);
  assert.equal(r.code, 400);
});

test('verify con código incorrecto no activa la MFA', async () => {
  await generateMfaSecret({ uid: U_OFF, mfaSetup: true }, res());
  const r = res();
  await verifyMfaSetup({ uid: U_OFF, mfaSetup: true, body: { token: '000000' } }, r);
  assert.equal(r.code, 400);
  assert.equal(users[U_OFF].mfaEnabled, false);
});

test('disable: 403, la MFA es obligatoria', async () => {
  const r = res();
  await disableMfa({ uid: U_ON }, r);
  assert.equal(r.code, 403);
  assert.equal(users[U_ON].mfaEnabled, true);
});

// ═══ otras vías de emitir token ═════════════════════════════════════════════

test('renewToken no renueva la sesión de una cuenta sin MFA', async () => {
  const r = res();
  await renewToken({ uid: U_OFF, name: 'N', tokenVersion: 0 }, r);
  assert.equal(r.code, 403);
  assert.equal(r.body.token, undefined);
});

test('renewToken sí renueva la de una cuenta con MFA', async () => {
  const r = res();
  await renewToken({ uid: U_ON, name: 'N', tokenVersion: 0 }, r);
  assert.equal(r.code, 200);
  assert.ok(r.body.token);
});

test('alta (createAdminUser): token de enrolamiento, ni token de sesión ni cookie', async () => {
  const r = res();
  await createAdminUser(req({ name: 'A', lastName: 'B', email: 'new@x.com', password: 'pw' }), r);
  assert.equal(r.code, 201);
  assert.equal(r.body.token, undefined);
  assert.equal('token' in r.cookies, false);
  assert.equal(r.body.mfaSetupRequired, true);
  assert.equal(verifyMfaSetupToken(r.body.mfaSetupToken), created[0].id);
});
