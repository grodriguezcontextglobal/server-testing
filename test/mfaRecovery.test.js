'use strict';

/**
 * Pérdida del dispositivo de MFA (FedRAMP A5).
 *
 *   - Al activar MFA salen 10 códigos de recuperación; en la base solo hashes.
 *   - En el login, `recoveryCode` sustituye a `mfaCode` una sola vez.
 *   - /mfa/recovery-codes los regenera pidiendo un código TOTP.
 *   - /mfa/reset/:id: un administrador borra la MFA de otro (nunca la propia),
 *     con el mismo criterio de compañías que el cambio de email.
 *   - scripts/mfa-coverage.js: el resumen cuenta bien.
 *
 * Que las rutas exijan sesión lo fija fedrampA2RouteIdentity.test.js.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const speakeasy = require('speakeasy');
const { totpNow } = require('./helpers/totp');

const U_ON = '222222222222222222222222';
const U_ADMIN = '555555555555555555555555';
const U_PLATFORM = '666666666666666666666666';
const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';

let users, memberships, otherCompanyMembers, updates, activity, redisDels;

function makeUser(id, email, extra) {
  const u = { id, _id: id, name: 'N', email, password: 'ok', tokenVersion: 0, active: true, ...extra };
  u.save = async () => u;
  return u;
}
function reset() {
  const secret = speakeasy.generateSecret();
  users = {
    [U_ON]: makeUser(U_ON, 'on@x.com', { mfaEnabled: true, mfaSecret: { base32: secret.base32 } }),
    [U_ADMIN]: makeUser(U_ADMIN, 'admin@x.com', { mfaEnabled: true }),
    [U_PLATFORM]: makeUser(U_PLATFORM, 'root@x.com', { mfaEnabled: true, super_user: true }),
  };
  // compañía -> email -> membresía
  memberships = {
    [COMPANY]: {
      'on@x.com': { roleType: 'assistant' },
      'admin@x.com': { roleType: 'admin', super_user: false },
    },
  };
  otherCompanyMembers = new Set();
  updates = [];
  activity = [];
  redisDels = [];
  sqlCompanies = [];
  delete process.env.MFA_REQUIRED;
}

const query = (val) => {
  const p = Promise.resolve(val);
  p.select = () => query(val);
  p.lean = () => Promise.resolve(val);
  return p;
};
const AdminUserStub = {
  findOne: ({ email }) => query(Object.values(users).find((x) => x.email === email) ?? null),
  findById: (id) => query(users[id] ?? null),
  findOneAndUpdate: async (filter, update) => {
    const u = users[filter._id];
    const hash = filter.mfaRecoveryCodes;
    if (!u || !(u.mfaRecoveryCodes || []).includes(hash)) return null;
    u.mfaRecoveryCodes = u.mfaRecoveryCodes.filter((h) => h !== update.$pull.mfaRecoveryCodes);
    return { mfaRecoveryCodes: u.mfaRecoveryCodes };
  },
  updateOne: async (filter, update) => {
    updates.push({ filter, update });
    const u = users[filter._id];
    if (update.$set) Object.assign(u, update.$set);
    for (const k of Object.keys(update.$unset || {})) delete u[k];
    if (update.$inc) u.tokenVersion += update.$inc.tokenVersion;
    return { modifiedCount: 1 };
  },
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
stub('models/Company.js', { exists: async () => otherCompanyMembers.size > 0 });
stub('models/StripeTransaction.js', {});
stub('helpers/jwt.js', { generateJWT: async (uid) => `session-token::${uid}`, SESSION_MAX_SECONDS: 43200 });
stub('helpers/logger.js', { warn: noop, error: noop, info: noop });
stub('helpers/companyContext.js', { resolveCompanyContext: (r) => r.headers?.['x-company-id'] ?? null });
stub('helpers/companyMembership.js', {
  findCompanyMembership: async (companyId, user) => memberships[companyId]?.[user.email] ?? null,
});
let sqlCompanies = [];
stub('mysql/database/config.js', () => ({
  execute: async (sql) => {
    if (sql.includes('FROM company_staff')) {
      if (sqlCompanies instanceof Error) throw sqlCompanies;
      return [sqlCompanies];
    }
    return [[{ staff_id: 7 }]];
  },
}));
stub('nodeMailer/notifications.js', { loginActivityNotification: async () => ({ success: true }) });
stub('controller/staffActivityLog.js', { logStaffActivity: async (e) => { activity.push(e); } });
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => ({
    set: async () => 'OK',
    get: async () => null,
    del: async (k) => { redisDels.push(k); return 1; },
  }),
});
stubPkg('bcrypt', { compare: async (pw, hash) => pw === hash, genSalt: async () => 's', hash: async (pw) => pw });

const {
  loginUser, verifyMfaSetup, regenerateRecoveryCodes, resetUserMfa,
} = require('../controller/admin');
const { generateRecoveryCodes, hashRecoveryCode } = require('../helpers/mfaRecoveryCodes');
const { summarize, byCompany } = require('../scripts/mfa-coverage');

beforeEach(reset);

function req(body = {}, headers = {}, extra = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { body, headers: h, ip: '127.0.0.1', header: (n) => h[n.toLowerCase()], ...extra };
}
function res() {
  const r = { cookies: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; if (r.code === undefined) r.code = 200; return r; };
  r.cookie = (n, v) => { r.cookies[n] = v; return r; };
  r.set = noop;
  return r;
}
const totp = (u) => totpNow(u.mfaSecret.base32);
function giveCodes(uid) {
  const { codes, hashes } = generateRecoveryCodes(uid);
  users[uid].mfaRecoveryCodes = hashes;
  return codes;
}

// ═══ helper ═════════════════════════════════════════════════════════════════

test('códigos: 10, formato xxxx-xxxx-xxxx-xxxx, únicos, y el hash no contiene el código', () => {
  const { codes, hashes } = generateRecoveryCodes(U_ON);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/);
  for (const [i, h] of hashes.entries()) {
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.ok(!h.includes(codes[i].replace(/-/g, '')));
  }
});

test('hash: ignora guiones, espacios y mayúsculas; cambia con el uid', () => {
  const code = 'abcd-efgh-ijkl-mnop';
  assert.equal(hashRecoveryCode(U_ON, code), hashRecoveryCode(U_ON, ' ABCDEFGH IJKLMNOP '));
  assert.notEqual(hashRecoveryCode(U_ON, code), hashRecoveryCode(U_ADMIN, code));
});

// ═══ activar MFA ════════════════════════════════════════════════════════════

test('verify al activar MFA: devuelve 10 códigos y guarda solo sus hashes', async () => {
  const u = users[U_ON];
  u.mfaEnabled = false;
  const r = res();
  await verifyMfaSetup(req({ token: totp(u) }, {}, { uid: U_ON }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.recoveryCodes.length, 10);
  assert.deepEqual(u.mfaRecoveryCodes, r.body.recoveryCodes.map((c) => hashRecoveryCode(U_ON, c)));
});

test('verify con MFA ya activa: no cambia ni devuelve códigos', async () => {
  const u = users[U_ON];
  giveCodes(U_ON);
  const before = [...u.mfaRecoveryCodes];
  const r = res();
  await verifyMfaSetup(req({ token: totp(u) }, {}, { uid: U_ON }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.recoveryCodes, undefined);
  assert.deepEqual(u.mfaRecoveryCodes, before);
});

// ═══ login con código de recuperación ═══════════════════════════════════════

test('login con recoveryCode válido: 200, lo gasta y dice cuántos quedan', async () => {
  const codes = giveCodes(U_ON);
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', recoveryCode: codes[3] }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.token, `session-token::${U_ON}`);
  assert.equal(r.body.recoveryCodeUsed, true);
  assert.equal(r.body.recoveryCodesRemaining, 9);
  assert.ok(activity.some((a) => a.action === 'MFA_RECOVERY_CODE_USED'));
});

test('el mismo recoveryCode no sirve dos veces', async () => {
  const codes = giveCodes(U_ON);
  await loginUser(req({ email: 'on@x.com', password: 'ok', recoveryCode: codes[0] }), res());
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', recoveryCode: codes[0] }), r);
  assert.equal(r.code, 400);
  assert.equal(r.body.msg, 'Invalid recovery code');
  assert.ok(activity.some((a) => a.action === 'LOGIN_FAILED' && a.details.reason === 'invalid_recovery_code'));
});

test('recoveryCode de otra cuenta o inventado: 400', async () => {
  giveCodes(U_ON);
  const ajenos = generateRecoveryCodes(U_ADMIN).codes;
  for (const recoveryCode of [ajenos[0], 'not-a-code', '']) {
    const r = res();
    await loginUser(req({ email: 'on@x.com', password: 'ok', recoveryCode: recoveryCode || 'x' }), r);
    assert.equal(r.code, 400, recoveryCode);
  }
});

test('login con recoveryCode y contraseña incorrecta: no gasta el código', async () => {
  const codes = giveCodes(U_ON);
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'mal', recoveryCode: codes[0] }), r);
  assert.equal(r.code, 400);
  assert.equal(users[U_ON].mfaRecoveryCodes.length, 10);
});

test('login con mfaCode sigue igual y no anuncia códigos', async () => {
  giveCodes(U_ON);
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', mfaCode: totp(users[U_ON]) }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.recoveryCodeUsed, undefined);
  assert.equal(users[U_ON].mfaRecoveryCodes.length, 10);
});

test('todo login con MFA dice cuántos códigos quedan; 0 si nunca los tuvo', async () => {
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', mfaCode: totp(users[U_ON]) }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.recoveryCodesRemaining, 0);
  giveCodes(U_ON);
  const r2 = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', mfaCode: totp(users[U_ON]) }), r2);
  assert.equal(r2.body.recoveryCodesRemaining, 10);
  assert.equal(r2.body.recoveryCodeUsed, undefined);
});

test('sin MFA activa (MFA_REQUIRED=false): recoveryCodesRemaining es null', async () => {
  process.env.MFA_REQUIRED = 'false';
  users[U_ON].mfaEnabled = false;
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok' }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.recoveryCodesRemaining, null);
});

test('login: companies trae las compañías SQL activas, sin repetir', async () => {
  sqlCompanies = [
    { company_id: 12, company_name: 'Acme' },
    { company_id: 12, company_name: 'Acme' },
    { company_id: 30, company_name: 'Beta' },
  ];
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', mfaCode: totp(users[U_ON]) }), r);
  assert.deepEqual(r.body.companies, [
    { sqlCompanyId: 12, companyName: 'Acme' },
    { sqlCompanyId: 30, companyName: 'Beta' },
  ]);
  assert.equal(r.body.sqlCompanyId, null, 'con varias, el cliente elige');
});

test('login: con una sola compañía, sqlCompanyId es esa', async () => {
  sqlCompanies = [{ company_id: 12, company_name: 'Acme' }];
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', mfaCode: totp(users[U_ON]) }), r);
  assert.equal(r.body.sqlCompanyId, 12);
});

test('login: si falla la consulta de compañías, el login entra igual', async () => {
  sqlCompanies = new Error('db down');
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', mfaCode: totp(users[U_ON]) }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.companies, []);
  assert.equal(r.body.sqlCompanyId, null);
});

// ═══ regenerar ══════════════════════════════════════════════════════════════

test('regenerar: exige código TOTP; con él, los viejos dejan de valer', async () => {
  const old = giveCodes(U_ON);
  const sin = res();
  await regenerateRecoveryCodes(req({}, {}, { uid: U_ON }), sin);
  assert.equal(sin.code, 400);

  const r = res();
  await regenerateRecoveryCodes(req({ mfaCode: totp(users[U_ON]) }, {}, { uid: U_ON }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.recoveryCodes.length, 10);
  assert.ok(!users[U_ON].mfaRecoveryCodes.includes(hashRecoveryCode(U_ON, old[0])));
  assert.ok(users[U_ON].mfaRecoveryCodes.includes(hashRecoveryCode(U_ON, r.body.recoveryCodes[0])));
});

// ═══ reset por un administrador ═════════════════════════════════════════════

test('reset de la propia MFA: 403', async () => {
  const r = res();
  await resetUserMfa(req({}, { 'x-company-id': COMPANY }, { uid: U_ON, params: { id: U_ON } }), r);
  assert.equal(r.code, 403);
  assert.equal(users[U_ON].mfaEnabled, true);
});

test('reset por admin de la compañía: borra MFA y códigos, sube tokenVersion y cierra la sesión', async () => {
  giveCodes(U_ON);
  const r = res();
  await resetUserMfa(req({}, { 'x-company-id': COMPANY }, { uid: U_ADMIN, params: { id: U_ON } }), r);
  assert.equal(r.code, 200);
  const u = users[U_ON];
  assert.equal(u.mfaEnabled, false);
  assert.equal(u.mfaSecret, undefined);
  assert.equal(u.mfaRecoveryCodes, undefined);
  assert.equal(u.tokenVersion, 1);
  assert.deepEqual(redisDels, [`staff_session:${U_ON}`, `staff_session:${U_ON}:owner`]);
  assert.ok(activity.some((a) => a.action === 'MFA_RESET' && a.target_id === U_ON));
});

test('tras el reset, el login pide enrolarse otra vez', async () => {
  await resetUserMfa(req({}, { 'x-company-id': COMPANY }, { uid: U_ADMIN, params: { id: U_ON } }), res());
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok' }), r);
  assert.equal(r.code, 403);
  assert.equal(r.body.mfaSetupRequired, true);
});

test('reset sin permiso de staff en la compañía: 403', async () => {
  memberships[COMPANY]['admin@x.com'] = { roleType: 'assistant' };
  const r = res();
  await resetUserMfa(req({}, { 'x-company-id': COMPANY }, { uid: U_ADMIN, params: { id: U_ON } }), r);
  assert.equal(r.code, 403);
  assert.equal(updates.length, 0);
});

test('reset de alguien que no es de la compañía: 404', async () => {
  delete memberships[COMPANY]['on@x.com'];
  const r = res();
  await resetUserMfa(req({}, { 'x-company-id': COMPANY }, { uid: U_ADMIN, params: { id: U_ON } }), r);
  assert.equal(r.code, 404);
  assert.equal(updates.length, 0);
});

test('reset de alguien que también está en otras compañías: solo plataforma', async () => {
  otherCompanyMembers.add('on@x.com');
  const r = res();
  await resetUserMfa(req({}, { 'x-company-id': COMPANY }, { uid: U_ADMIN, params: { id: U_ON } }), r);
  assert.equal(r.code, 403);
  assert.equal(updates.length, 0);

  const p = res();
  await resetUserMfa(req({}, {}, { uid: U_PLATFORM, params: { id: U_ON } }), p);
  assert.equal(p.code, 200);
});

// ═══ informe de cobertura ═══════════════════════════════════════════════════

test('mfa-coverage: cuenta activas, con/sin MFA y sin códigos', () => {
  const s = summarize([
    { _id: '1', email: 'a@x', active: true, mfaEnabled: true, mfaSecret: { base32: true }, mfaRecoveryCodes: ['h'] },
    { _id: '2', email: 'b@x', active: true, mfaEnabled: true, mfaSecret: { base32: true }, mfaRecoveryCodes: [] },
    { _id: '3', email: 'c@x', active: true, mfaEnabled: true, mfaSecret: null },
    { _id: '4', email: 'd@x', mfaEnabled: false },
    { _id: '5', email: 'e@x', active: false, mfaEnabled: false },
  ]);
  assert.deepEqual(
    { ...s, withoutMfaEmails: undefined },
    { total: 5, inactive: 1, active: 4, withMfa: 2, withoutMfa: 2, withMfaNoRecoveryCodes: 1, withoutMfaEmails: undefined }
  );
  assert.deepEqual(s.withoutMfaEmails, ['c@x', 'd@x']);
});

test('mfa-coverage: por compañía casa por userId o por email y no cuenta inactivos', () => {
  const users = [
    { _id: 'u1', email: 'a@x', mfaEnabled: true, mfaSecret: { base32: true } },
    { _id: 'u2', email: 'B@x', mfaEnabled: false },
    { _id: 'u3', email: 'c@x', active: false },
  ];
  const rows = byCompany(
    [{ _id: 'c1', company_name: 'Acme', employees: [{ userId: 'u1' }, { user: 'b@x' }, { user: 'c@x' }, { user: 'a@x', active: false }] }],
    users
  );
  assert.deepEqual(rows, [{ company: 'Acme', members: 2, withMfa: 1, withoutMfa: 1 }]);
});
