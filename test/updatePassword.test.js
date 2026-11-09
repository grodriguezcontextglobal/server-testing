'use strict';

/**
 * PATCH /api/admin/update-password: sin token (reset sin sesión), pero con el
 * código MFA de la cuenta verificado en el servidor. Antes bastaba el email.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const speakeasy = require('speakeasy');
const { totpNow } = require('./helpers/totp');

const U = '333333333333333333333333';
const N = '444444444444444444444444';
const SECRET = speakeasy.generateSecret().base32;
let users, calls;

function reset() {
  users = {
    'mfa@a.com': { id: U, email: 'mfa@a.com', password: 'hash-mfa', mfaEnabled: true, mfaSecret: { base32: SECRET } },
    'nomfa@a.com': { id: N, email: 'nomfa@a.com', password: 'hash-nomfa', mfaEnabled: false },
  };
  calls = { updates: [], redisDel: [], finds: [], selects: [] };
}

const byId = (id) => Object.values(users).find((u) => u.id === id) ?? null;
const AdminUserStub = {
  findOne: ({ email, _id }) => {
    const u = (_id ? byId(_id) : users[email]) ?? null;
    return { select: async () => u, then: (r) => r(u) };
  },
  findById: (id) => ({ select: async (f) => { calls.selects.push(f); return byId(id); } }),
  find: (filter) => ({
    select: async (fields) => {
      calls.finds.push({ filter, fields });
      return Object.values(users).filter((u) => u.email === filter.email);
    },
  }),
  findByIdAndUpdate: async (id, update) => {
    calls.updates.push({ id, update });
    return { id, name: 'N', email: 'mfa@a.com' };
  },
};

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const noop = () => {};
stub('models/AdminUser.js', AdminUserStub);
for (const m of ['Company', 'StripeTransaction']) stub(`models/${m}.js`, {});
stub('helpers/queue.js', { enqueue: async () => ({ id: 'J' }), extractJobContext: () => ({}) });
stub('helpers/jwt.js', { generateJWT: async () => 'tok' });
stub('helpers/logger.js', { warn: noop, error: noop, info: noop });
stub('mysql/database/config.js', () => ({ execute: async () => [[]] }));
stub('nodeMailer/notifications.js', { loginActivityNotification: async () => ({}) });
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => ({ del: async (k) => { calls.redisDel.push(k); return 1; } }),
});
stub('controller/staffActivityLog.js', { logStaffActivity: async () => {} });

const { updatePassword, searchStaffByEmail, verifyPassword, attachPasswordResetLink } = require('../controller/admin');
const { generatePasswordResetToken } = require('../helpers/passwordResetToken');

const res = () => {
  const r = {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; if (r.code === undefined) r.code = 200; return r; };
  return r;
};
const call = async (body) => { const r = res(); await updatePassword({ body }, r); return r; };
const code = () => totpNow(SECRET);

beforeEach(reset);

test('update-password: con el código MFA correcto cambia la contraseña, invalida tokens y borra la sesión', async () => {
  const r = await call({ email: 'mfa@a.com', password: 'nueva-clave-123', mfaCode: code() });
  assert.equal(r.code, 201);
  assert.equal(calls.updates.length, 1);
  const { update } = calls.updates[0];
  assert.ok(update.$set.password && update.$set.password !== 'nueva-clave-123', 'se guarda el hash, no la contraseña');
  assert.deepEqual(update.$inc, { tokenVersion: 1 });
  assert.deepEqual(calls.redisDel, [`staff_session:${U}`, `staff_session:${U}:owner`]);
});

test('update-password: una contraseña de menos de 12 caracteres da 400 y no cambia nada (IA-5)', async () => {
  const r = await call({ email: 'mfa@a.com', password: 'nueva123', mfaCode: code() });
  assert.equal(r.code, 400);
  assert.match(r.body.msg, /12/);
  assert.equal(calls.updates.length, 0);
});

test('update-password: solo con el email (como antes) da 403 mfaRequired y no cambia nada', async () => {
  const r = await call({ email: 'mfa@a.com', password: 'nueva-clave-123' });
  assert.equal(r.code, 403);
  assert.equal(r.body.mfaRequired, true);
  assert.equal(calls.updates.length, 0);
});

test('update-password: código MFA incorrecto da 400 y no cambia nada', async () => {
  const r = await call({ email: 'mfa@a.com', password: 'nueva-clave-123', mfaCode: '000000' });
  assert.equal(r.code, 400);
  assert.equal(calls.updates.length, 0);
});

test('update-password: email desconocido responde igual que un código incorrecto', async () => {
  const r = await call({ email: 'nadie@a.com', password: 'nueva-clave-123', mfaCode: '123456' });
  assert.equal(r.code, 400);
  assert.equal(r.body.msg, 'Invalid email or MFA code');
  assert.equal(calls.updates.length, 0);
});

test('update-password: cuenta sin MFA da 403 mfaSetupRequired (activarla y reenviar), con o sin código', async () => {
  for (const mfaCode of [undefined, '123456']) {
    const r = await call({ email: 'nomfa@a.com', password: 'nueva-clave-123', mfaCode });
    assert.equal(r.code, 403);
    assert.equal(r.body.mfaSetupRequired, true);
    assert.equal(r.body.mfaRequired, undefined);
    assert.match(r.body.msg, /Enable MFA.*send this request again/);
    assert.equal(r.body.mfaSetupToken, undefined, 'sin enlace firmado no hay token de enrolamiento');
  }
  assert.equal(calls.updates.length, 0);
});

test('update-password: email desconocido sin código pide el código, igual que una cuenta con MFA', async () => {
  const r = await call({ email: 'nadie@a.com', password: 'nueva-clave-123' });
  assert.equal(r.code, 403);
  assert.equal(r.body.mfaRequired, true);
});

test('update-password: contraseña ausente o corta da 400', async () => {
  for (const password of [undefined, '', '12345']) {
    const r = await call({ email: 'mfa@a.com', password, mfaCode: code() });
    assert.equal(r.code, 400, String(password));
  }
  assert.equal(calls.updates.length, 0);
});

test('update-password: el enlace del reset puede identificar la cuenta por uid', async () => {
  const r = await call({ uid: U, password: 'nueva-clave-123', mfaCode: code() });
  assert.equal(r.code, 201);
  assert.equal(calls.updates[0].id, U);
});

test('update-password: un objeto como email o uid (filtro de Mongo) se rechaza con 400', async () => {
  for (const body of [{ email: { $ne: null } }, { uid: { $ne: null } }]) {
    const r = await call({ ...body, password: 'nueva-clave-123', mfaCode: code() });
    assert.equal(r.code, 400);
  }
  assert.equal(calls.updates.length, 0);
});

// ── enlace firmado del correo (resetToken) ─────────────────────────────────
process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';
const { verifyMfaSetupToken } = require('../helpers/mfaSetupToken');

test('update-password: cuenta sin MFA CON enlace firmado recibe mfaSetupToken de esa cuenta', async () => {
  const resetToken = await generatePasswordResetToken(users['nomfa@a.com']);
  const r = await call({ resetToken, password: 'nueva-clave-123' });
  assert.equal(r.code, 403);
  assert.equal(r.body.mfaSetupRequired, true);
  assert.equal(verifyMfaSetupToken(r.body.mfaSetupToken), N);
  assert.equal(calls.updates.length, 0);
});

test('update-password: con enlace firmado y código MFA cambia la contraseña (la cuenta sale del token)', async () => {
  const resetToken = await generatePasswordResetToken(users['mfa@a.com']);
  const r = await call({ resetToken, email: 'nomfa@a.com', password: 'nueva-clave-123', mfaCode: code() });
  assert.equal(r.code, 201);
  assert.equal(calls.updates[0].id, U);
});

test('update-password: enlace falso, ajeno o ya usado da 400 resetLinkInvalid y no emite nada', async () => {
  const used = await generatePasswordResetToken(users['nomfa@a.com']);
  users['nomfa@a.com'].password = 'hash-nuevo'; // la contraseña ya cambió con ese enlace
  for (const resetToken of ['basura', { $ne: null }, used]) {
    const r = await call({ resetToken, password: 'nueva-clave-123' });
    assert.equal(r.code, 400, String(resetToken));
    assert.equal(r.body.resetLinkInvalid, true);
    assert.equal(r.body.mfaSetupToken, undefined);
  }
  assert.equal(calls.updates.length, 0);
});

// ── POST /nodemailer/reset-admin-password ──────────────────────────────────
const attach = async (body) => {
  const r = res();
  const req = { body };
  let nexted = false;
  await attachPasswordResetLink(req, r, () => { nexted = true; });
  return { r, req, nexted };
};

test('reset-admin-password: el servidor arma el enlace con un token firmado y descarta el del cliente', async () => {
  const { req, nexted } = await attach({
    contactInfo: { email: 'nomfa@a.com' },
    linkToResetPassword: 'https://evil.example/phish',
    link: 'https://evil.example/phish',
  });
  assert.equal(nexted, true);
  const url = new URL(req.body.linkToResetPassword);
  assert.equal(url.pathname, '/reset-password');
  assert.equal(url.searchParams.get('uid'), N);
  assert.equal(req.body.link, undefined);
  const r = await call({ resetToken: url.searchParams.get('token'), password: 'nueva-clave-123' });
  assert.ok(r.body.mfaSetupToken, 'el token del correo abre el enrolamiento');
});

test('reset-admin-password: email sin cuenta responde igual pero no envía nada', async () => {
  const { r, nexted } = await attach({ contactInfo: { email: 'nadie@a.com' } });
  assert.equal(r.code, 202);
  assert.equal(nexted, false);
  const bad = await attach({ contactInfo: { email: { $ne: null } } });
  assert.equal(bad.r.code, 400);
  assert.equal(bad.nexted, false);
});

// ── __staff-search ──────────────────────────────────────────────────────────
const search = async (req) => { const r = res(); await searchStaffByEmail(req, r); return r; };

test('__staff-search: sin email (antes devolvía TODOS los usuarios) da 400', async () => {
  for (const req of [{ body: {}, query: {} }, { body: { email: { $ne: null } }, query: {} }]) {
    const r = await search(req);
    assert.equal(r.code, 400);
  }
  assert.equal(calls.finds.length, 0);
});

test('__staff-search: busca el email exacto y pide solo campos públicos', async () => {
  const r = await search({ body: { email: ' mfa@a.com ' }, query: {} });
  assert.equal(r.code, 201);
  assert.equal(r.body.adminUsers.length, 1);
  assert.deepEqual(calls.finds[0].filter, { email: 'mfa@a.com' });
  assert.doesNotMatch(calls.finds[0].fields, /password|mfaSecret|tokenVersion|super_user/);
});

test('__staff-search: también por query (?email=) para el GET', async () => {
  const r = await search({ body: {}, query: { email: 'mfa@a.com' } });
  assert.equal(r.code, 201);
});

// ── verify-password ─────────────────────────────────────────────────────────
const bcrypt = require('bcrypt');
const verify = async (uid, password) => { const r = res(); await verifyPassword({ uid, body: { password } }, r); return r; };

test('verify-password: compara en el servidor contra el hash del propio usuario', async () => {
  users['mfa@a.com'].password = bcrypt.hashSync('actual123', 4);
  assert.deepEqual((await verify(U, 'actual123')).body, { ok: true, valid: true });
  assert.deepEqual((await verify(U, 'otra')).body, { ok: true, valid: false });
  assert.deepEqual(calls.selects, ['+password', '+password']);
  assert.equal((await verify(U, '')).code, 400);
});

// ── el hash nunca se serializa ──────────────────────────────────────────────
test('AdminUser: password está oculto por defecto y toJSON nunca lo devuelve', () => {
  delete require.cache[path.join(root, 'models/AdminUser.js')];
  const AdminUser = require('../models/AdminUser');
  assert.equal(AdminUser.schema.path('password').options.select, false);
  const doc = new AdminUser({ name: 'A', lastName: 'B', email: 'a@b.c', password: 'hash', mfaSecret: { base32: 'X' } });
  const json = doc.toJSON();
  assert.equal('password' in json, false);
  assert.equal('mfaSecret' in json, false);
  assert.equal(json.email, 'a@b.c');
});
