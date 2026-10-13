'use strict';

/**
 * PATCH /api/admin/update-password: sin token (reset sin sesión), pero con el
 * código MFA de la cuenta verificado en el servidor. Antes bastaba el email.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const speakeasy = require('speakeasy');

const U = '333333333333333333333333';
const SECRET = speakeasy.generateSecret().base32;
let users, calls;

function reset() {
  users = {
    'mfa@a.com': { id: U, email: 'mfa@a.com', mfaEnabled: true, mfaSecret: { base32: SECRET } },
    'nomfa@a.com': { id: 'x', email: 'nomfa@a.com', mfaEnabled: false },
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

const { updatePassword, searchStaffByEmail, verifyPassword } = require('../controller/admin');

const res = () => {
  const r = {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; if (r.code === undefined) r.code = 200; return r; };
  return r;
};
const call = async (body) => { const r = res(); await updatePassword({ body }, r); return r; };
const code = () => speakeasy.totp({ secret: SECRET, encoding: 'base32' });

beforeEach(reset);

test('update-password: con el código MFA correcto cambia la contraseña, invalida tokens y borra la sesión', async () => {
  const r = await call({ email: 'mfa@a.com', password: 'nueva123', mfaCode: code() });
  assert.equal(r.code, 201);
  assert.equal(calls.updates.length, 1);
  const { update } = calls.updates[0];
  assert.ok(update.$set.password && update.$set.password !== 'nueva123', 'se guarda el hash, no la contraseña');
  assert.deepEqual(update.$inc, { tokenVersion: 1 });
  assert.deepEqual(calls.redisDel, [`staff_session:${U}`, `staff_session:${U}:owner`]);
});

test('update-password: solo con el email (como antes) da 403 mfaRequired y no cambia nada', async () => {
  const r = await call({ email: 'mfa@a.com', password: 'nueva123' });
  assert.equal(r.code, 403);
  assert.equal(r.body.mfaRequired, true);
  assert.equal(calls.updates.length, 0);
});

test('update-password: código MFA incorrecto da 400 y no cambia nada', async () => {
  const r = await call({ email: 'mfa@a.com', password: 'nueva123', mfaCode: '000000' });
  assert.equal(r.code, 400);
  assert.equal(calls.updates.length, 0);
});

test('update-password: email desconocido responde igual que un código incorrecto', async () => {
  const r = await call({ email: 'nadie@a.com', password: 'nueva123', mfaCode: '123456' });
  assert.equal(r.code, 400);
  assert.equal(r.body.msg, 'Invalid email or MFA code');
  assert.equal(calls.updates.length, 0);
});

test('update-password: cuenta sin MFA configurada da 403 mfaSetupRequired', async () => {
  const r = await call({ email: 'nomfa@a.com', password: 'nueva123', mfaCode: '123456' });
  assert.equal(r.code, 403);
  assert.equal(r.body.mfaSetupRequired, true);
  assert.equal(calls.updates.length, 0);
});

test('update-password: contraseña ausente o corta da 400', async () => {
  for (const password of [undefined, '', '12345']) {
    const r = await call({ email: 'mfa@a.com', password, mfaCode: code() });
    assert.equal(r.code, 400, String(password));
  }
  assert.equal(calls.updates.length, 0);
});

test('update-password: el enlace del reset puede identificar la cuenta por uid', async () => {
  const r = await call({ uid: U, password: 'nueva123', mfaCode: code() });
  assert.equal(r.code, 201);
  assert.equal(calls.updates[0].id, U);
});

test('update-password: un objeto como email o uid (filtro de Mongo) se rechaza con 400', async () => {
  for (const body of [{ email: { $ne: null } }, { uid: { $ne: null } }]) {
    const r = await call({ ...body, password: 'nueva123', mfaCode: code() });
    assert.equal(r.code, 400);
  }
  assert.equal(calls.updates.length, 0);
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
