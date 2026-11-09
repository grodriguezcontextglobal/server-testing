'use strict';

/**
 * Bloqueo por intentos fallidos de login (FedRAMP AC-7) y registro de cada
 * fallo en el audit trail (AU-2).
 *
 *   - Contraseña o código MFA incorrectos suman al contador de la cuenta.
 *   - Al llegar a LOGIN_MAX_ATTEMPTS la cuenta da 429 aunque la contraseña sea
 *     buena, con Retry-After.
 *   - Un login correcto pone el contador a cero.
 *   - Cada fallo deja una fila LOGIN_FAILED (también los de emails sin cuenta).
 *   - Sin Redis, el login funciona igual (fail-open).
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';
process.env.LOGIN_MAX_ATTEMPTS = '3';
process.env.LOGIN_LOCKOUT_S = '1800';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const speakeasy = require('speakeasy');

const U = '111111111111111111111111';
const SECRET = speakeasy.generateSecret().base32;

let users, store, activity, redisDown;

function reset() {
  users = {
    [U]: { id: U, name: 'N', email: 'ana@x.com', password: 'buena', tokenVersion: 0, active: true,
      mfaEnabled: true, mfaSecret: { base32: SECRET }, save: async () => {} },
  };
  store = new Map();
  activity = [];
  redisDown = false;
}

// Redis en memoria con lo que usan la sesión única y el contador.
const ttls = new Map();
const fakeRedis = {
  set: async (k, v, opts = {}) => {
    if (opts.NX && store.has(k)) return null;
    store.set(k, v);
    if (opts.EX) ttls.set(k, opts.EX);
    return 'OK';
  },
  get: async (k) => store.get(k) ?? null,
  del: async (k) => { store.delete(k); ttls.delete(k); return 1; },
  incr: async (k) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; },
  expire: async (k, s) => { ttls.set(k, s); return 1; },
  ttl: async (k) => (store.has(k) ? ttls.get(k) ?? -1 : -2),
};

const query = (val) => {
  const p = Promise.resolve(val);
  p.select = () => query(val);
  p.lean = () => Promise.resolve(val);
  return p;
};
const AdminUserStub = function () {};
AdminUserStub.findOne = ({ email }) => query(Object.values(users).find((x) => x.email === email) ?? null);
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
stub('controller/staffActivityLog.js', { logStaffActivity: async (row) => { activity.push(row); } });
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => {
    if (redisDown) throw new Error('redis down');
    return fakeRedis;
  },
});
stubPkg('bcrypt', { compare: async (pw, hash) => pw === hash, genSalt: async () => 's', hash: async (pw) => pw });

const { loginUser } = require('../controller/admin');

beforeEach(() => { reset(); ttls.clear(); });

function req(body) {
  return { body, headers: { 'user-agent': 'test' }, ip: '127.0.0.1', header: () => undefined };
}
function res() {
  const r = { headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; if (r.code === undefined) r.code = 200; return r; };
  r.cookie = () => r;
  r.set = (k, v) => { r.headers[k] = v; return r; };
  return r;
}
const login = async (body) => { const r = res(); await loginUser(req(body), r); return r; };
const totp = () => speakeasy.totp({ secret: SECRET, encoding: 'base32' });

test('tras 3 contraseñas incorrectas la cuenta da 429 aunque la contraseña sea buena', async () => {
  assert.equal((await login({ email: 'ana@x.com', password: 'mal' })).code, 400);
  assert.equal((await login({ email: 'ana@x.com', password: 'mal' })).code, 400);
  const third = await login({ email: 'ana@x.com', password: 'mal' });
  assert.equal(third.code, 429);
  assert.equal(third.body.accountLocked, true);
  assert.equal(third.headers['Retry-After'], '1800');

  const good = await login({ email: 'ana@x.com', password: 'buena', mfaCode: totp() });
  assert.equal(good.code, 429);
  assert.equal(good.body.token, undefined);
});

test('el código MFA incorrecto también cuenta', async () => {
  for (let i = 0; i < 2; i++) {
    assert.equal((await login({ email: 'ana@x.com', password: 'buena', mfaCode: '000000' })).code, 400);
  }
  assert.equal((await login({ email: 'ana@x.com', password: 'buena', mfaCode: '000000' })).code, 429);
});

test('un login correcto pone el contador a cero', async () => {
  await login({ email: 'ana@x.com', password: 'mal' });
  await login({ email: 'ana@x.com', password: 'mal' });
  const ok = await login({ email: 'ana@x.com', password: 'buena', mfaCode: totp(), forceLogin: true });
  assert.equal(ok.code, 200);
  assert.equal(store.has('login_fail:ana@x.com'), false);
  // dos fallos más no bloquean: el contador volvió a empezar
  await login({ email: 'ana@x.com', password: 'mal' });
  assert.equal((await login({ email: 'ana@x.com', password: 'mal' })).code, 400);
});

test('el contador es por email sin distinguir mayúsculas', async () => {
  await login({ email: 'ana@x.com', password: 'mal' });
  await login({ email: 'ANA@x.com', password: 'mal' });
  assert.equal((await login({ email: 'Ana@X.com', password: 'mal' })).code, 429);
});

test('cada fallo queda en el audit trail, también el de un email sin cuenta', async () => {
  await login({ email: 'ana@x.com', password: 'mal' });
  await login({ email: 'nadie@x.com', password: 'x' });
  const failed = activity.filter((a) => a.action === 'LOGIN_FAILED');
  assert.equal(failed.length, 2);
  assert.equal(failed[0].staff_member_id, U);
  assert.equal(failed[0].actor_type, 'staff');
  assert.equal(failed[0].details.reason, 'invalid_password');
  assert.equal(failed[1].staff_member_id, null);
  assert.equal(failed[1].actor_type, 'anonymous');
  assert.equal(failed[1].details.reason, 'unknown_user');
  assert.equal(failed[1].details.email, 'nadie@x.com');
});

test('un email sin cuenta responde igual que una contraseña incorrecta y también se bloquea', async () => {
  const unknown = await login({ email: 'nadie@x.com', password: 'x' });
  const wrong = await login({ email: 'ana@x.com', password: 'mal' });
  assert.equal(unknown.code, wrong.code);
  assert.equal(unknown.body.msg, wrong.body.msg);
  await login({ email: 'nadie@x.com', password: 'x' });
  const third = await login({ email: 'nadie@x.com', password: 'x' });
  assert.equal(third.code, 429);
  assert.equal(third.body.accountLocked, true);
});

test('el 400 dice cuántos intentos quedan', async () => {
  assert.equal((await login({ email: 'ana@x.com', password: 'mal' })).body.attemptsRemaining, 2);
  assert.equal((await login({ email: 'nadie@x.com', password: 'x' })).body.attemptsRemaining, 2);
  assert.equal((await login({ email: 'ana@x.com', password: 'mal' })).body.attemptsRemaining, 1);
});

test('sin Redis no se bloquea el login (fail-open)', async () => {
  redisDown = true;
  for (let i = 0; i < 4; i++) {
    assert.equal((await login({ email: 'ana@x.com', password: 'mal' })).code, 400);
  }
});

// AC-2(3), 2026-11-09: cuenta desactivada (por inactividad o a mano).
test('cuenta desactivada: con la contraseña correcta, 403 accountDisabled y sin token', async () => {
  users[U].active = false;
  users[U].deactivatedReason = 'inactivity';
  const r = await login({ email: 'ana@x.com', password: 'buena', mfaCode: totp() });
  assert.equal(r.code, 403);
  assert.equal(r.body.accountDisabled, true);
  assert.equal(r.body.token, undefined);
  const row = activity.find((a) => a.action === 'LOGIN_FAILED');
  assert.equal(row.details.reason, 'account_disabled');
  assert.equal(row.details.deactivatedReason, 'inactivity');
});

test('cuenta desactivada: con contraseña incorrecta responde como siempre (no revela el estado)', async () => {
  users[U].active = false;
  const r = await login({ email: 'ana@x.com', password: 'mal' });
  assert.equal(r.code, 400);
  assert.equal(r.body.accountDisabled, undefined);
});

test('el login no espera ni falla por los datos de uso de la cuenta (Mongo sin conectar en el test)', async () => {
  // AdminUserStub no tiene updateOne: helpers/accountActivity no hace nada y el login sigue.
  const r = await login({ email: 'ana@x.com', password: 'buena', mfaCode: totp() });
  assert.equal(r.code, 200);
  assert.equal((await login({ email: 'ana@x.com', password: 'mal' })).code, 400);
});

test('cuenta desactivada: los intentos con la contraseña correcta no suman al bloqueo', async () => {
  users[U].active = false;
  for (let i = 0; i < 4; i++) {
    assert.equal((await login({ email: 'ana@x.com', password: 'buena' })).code, 403);
  }
  assert.equal([...store.keys()].some((k) => /attempt|lock/i.test(k)), false);
});
