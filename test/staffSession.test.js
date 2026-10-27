'use strict';

/**
 * Sesión de staff en el servidor (FedRAMP A6 · AC-12, AC-2(5)).
 *
 *   - El login abre una sesión (sid en el JWT y en Redis) y arranca el reloj
 *     de inactividad.
 *   - checkTokenVersion rechaza (SESSION_MODE=enforce) el token de una sesión
 *     cerrada o sustituida, o inactiva más de SESSION_IDLE_MINUTES.
 *   - warn deja pasar; off no mira; Redis caído deja pasar.
 *   - /renew conserva el sid; el logout de un token viejo no cierra la sesión
 *     nueva.
 *
 * Que /renew exija sesión vigente lo fija fedrampA2RouteIdentity.test.js.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');

const UID = '222222222222222222222222';
let users, store, ttls, redisDown, warnings;

function reset() {
  const secret = speakeasy.generateSecret();
  const u = { id: UID, _id: UID, name: 'N', email: 'on@x.com', password: 'ok', tokenVersion: 0, active: true,
    mfaEnabled: true, mfaSecret: { base32: secret.base32 } };
  u.save = async () => u;
  users = { [UID]: u };
  store = {};
  ttls = {};
  redisDown = false;
  warnings = [];
  delete process.env.SESSION_MODE;
  delete process.env.SESSION_IDLE_MINUTES;
  delete process.env.DISABLE_SESSION_GUARD;
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
};
const redis = {
  set: async (k, v, opts) => {
    if (opts?.NX && store[k] !== undefined) return null;
    store[k] = v;
    ttls[k] = opts?.EX;
    return 'OK';
  },
  get: async (k) => store[k] ?? null,
  del: async (k) => { delete store[k]; return 1; },
};
const clientRedis = () => (redisDown ? new Promise(() => {}) : Promise.resolve(redis));

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
stub('helpers/logger.js', { warn: (msg, meta) => warnings.push({ msg, meta }), error: noop, info: noop });
stub('mysql/database/config.js', () => ({ execute: async () => [[{ staff_id: 7 }]] }));
stub('nodeMailer/notifications.js', { loginActivityNotification: async () => ({ success: true }) });
stub('controller/staffActivityLog.js', { logStaffActivity: async () => {} });
stub('database/cacheMemoryConfig.js', { clientRedis });
stubPkg('bcrypt', { compare: async (pw, hash) => pw === hash, genSalt: async () => 's', hash: async (pw) => pw });

const { loginUser, logoutUser, renewToken } = require('../controller/admin');
const { checkTokenVersion } = require('../middlewares/checkValidateToken');
const { validateJWT } = require('../middlewares/validate-jwt');
const { idleKey, sessionKey } = require('../helpers/staffSession');

beforeEach(reset);
afterEach(reset);

function req(body = {}, headers = {}, extra = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { body, headers: h, ip: '127.0.0.1', header: (n) => h[n.toLowerCase()], ...extra };
}
function res() {
  const r = { cookies: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; if (r.code === undefined) r.code = 200; return r; };
  r.cookie = (n, v) => { r.cookies[n] = v; return r; };
  r.clearCookie = () => r;
  r.set = noop;
  return r;
}
const totp = () => speakeasy.totp({ secret: users[UID].mfaSecret.base32, encoding: 'base32' });

async function login(extra = {}) {
  const r = res();
  await loginUser(req({ email: 'on@x.com', password: 'ok', mfaCode: totp(), ...extra }), r);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  return r.body.token;
}
async function call(token) {
  const r = res();
  let passed = false;
  await checkTokenVersion(req({}, { 'x-token': token }), r, () => { passed = true; });
  return { passed, r };
}

// ═══ login ══════════════════════════════════════════════════════════════════

test('login: el token lleva un sid, Redis lo guarda y arranca el reloj de inactividad (30 min)', async () => {
  const token = await login();
  const { sid } = jwt.decode(token);
  assert.match(sid, /^[0-9a-f]{32}$/);
  assert.equal(store[sessionKey(UID)], sid);
  assert.equal(store[idleKey(UID)], '1');
  assert.equal(ttls[idleKey(UID)], 30 * 60);
});

test('dos logins seguidos dan sids distintos', async () => {
  const a = jwt.decode(await login()).sid;
  const b = jwt.decode(await login({ forceLogin: true })).sid;
  assert.notEqual(a, b);
});

// ═══ enforce ════════════════════════════════════════════════════════════════

test('enforce: sesión vigente pasa y renueva el reloj', async () => {
  process.env.SESSION_MODE = 'enforce';
  const token = await login();
  ttls[idleKey(UID)] = 1;
  const { passed } = await call(token);
  assert.equal(passed, true);
  assert.equal(ttls[idleKey(UID)], 30 * 60);
});

test('enforce: tras el logout el token ya no vale aunque no haya caducado', async () => {
  process.env.SESSION_MODE = 'enforce';
  const token = await login();
  await logoutUser(req({}, { 'x-token': token }), res());
  const { passed, r } = await call(token);
  assert.equal(passed, false);
  assert.equal(r.code, 401);
  assert.equal(r.body.reason, 'revoked');
  assert.equal(r.body.sessionEnded, true);
});

test('enforce: un login nuevo (forceLogin) anula el token anterior', async () => {
  process.env.SESSION_MODE = 'enforce';
  const old = await login();
  const fresh = await login({ forceLogin: true });
  assert.equal((await call(old)).r.body.reason, 'revoked');
  assert.equal((await call(fresh)).passed, true);
});

test('logout con el token viejo no cierra la sesión nueva', async () => {
  process.env.SESSION_MODE = 'enforce';
  const old = await login();
  const fresh = await login({ forceLogin: true });
  await logoutUser(req({}, { 'x-token': old }), res());
  assert.equal((await call(fresh)).passed, true);
});

test('enforce: inactividad agotada -> 401 idle', async () => {
  process.env.SESSION_MODE = 'enforce';
  const token = await login();
  delete store[idleKey(UID)];
  const { passed, r } = await call(token);
  assert.equal(passed, false);
  assert.equal(r.body.reason, 'idle');
});

test('enforce: SESSION_IDLE_MINUTES=0 desactiva la inactividad pero no la revocación', async () => {
  process.env.SESSION_MODE = 'enforce';
  process.env.SESSION_IDLE_MINUTES = '0';
  const token = await login();
  assert.equal(store[idleKey(UID)], undefined);
  assert.equal((await call(token)).passed, true);
  delete store[sessionKey(UID)];
  assert.equal((await call(token)).r.body.reason, 'revoked');
});

test('enforce: token sin sid (anterior a A6) -> 401', async () => {
  process.env.SESSION_MODE = 'enforce';
  const legacy = jwt.sign({ uid: UID, name: 'N', tokenVersion: 0 }, process.env.SECRET_JWT_SEED);
  const { passed, r } = await call(legacy);
  assert.equal(passed, false);
  assert.equal(r.body.reason, 'no_sid');
});

test('enforce: con DISABLE_SESSION_GUARD (cuentas compartidas) no se revoca por sid', async () => {
  process.env.SESSION_MODE = 'enforce';
  process.env.DISABLE_SESSION_GUARD = 'true';
  const a = await login();
  await login();
  assert.equal((await call(a)).passed, true);
});

test('tokenVersion sigue mandando: un token de versión vieja es 401 aunque la sesión viva', async () => {
  process.env.SESSION_MODE = 'enforce';
  const token = await login();
  users[UID].tokenVersion = 1;
  assert.equal((await call(token)).r.code, 401);
});

// ═══ warn, off y Redis caído ════════════════════════════════════════════════

test('warn (por defecto): deja pasar una sesión cerrada y lo registra', async () => {
  const token = await login();
  delete store[sessionKey(UID)];
  const { passed } = await call(token);
  assert.equal(passed, true);
  assert.ok(warnings.some((w) => w.meta?.reason === 'revoked'));
});

test('warn: un token sin sid pasa sin aviso (caducan solos en 12 h)', async () => {
  const legacy = jwt.sign({ uid: UID, name: 'N', tokenVersion: 0 }, process.env.SECRET_JWT_SEED);
  assert.equal((await call(legacy)).passed, true);
  assert.equal(warnings.length, 0);
});

test('off: no mira nada', async () => {
  process.env.SESSION_MODE = 'off';
  const token = await login();
  delete store[sessionKey(UID)];
  delete store[idleKey(UID)];
  assert.equal((await call(token)).passed, true);
});

test('Redis que no responde: deja pasar a los 1.5 s, con aviso', async () => {
  process.env.SESSION_MODE = 'enforce';
  const token = await login();
  redisDown = true;
  const { passed } = await call(token);
  assert.equal(passed, true);
  assert.ok(warnings.some((w) => /Redis unavailable/.test(w.msg)));
});

// ═══ renovación ═════════════════════════════════════════════════════════════

test('renew conserva el sid: el token renovado sigue valiendo y cae con el logout', async () => {
  process.env.SESSION_MODE = 'enforce';
  const token = await login();
  const q = req({}, { 'x-token': token });
  validateJWT(q, res(), noop);
  const r = res();
  await renewToken(q, r);
  const renewed = r.body.token;
  assert.equal(jwt.decode(renewed).sid, jwt.decode(token).sid);
  assert.equal((await call(renewed)).passed, true);
  await logoutUser(req({}, { 'x-token': token }), res());
  assert.equal((await call(renewed)).passed, false);
});
