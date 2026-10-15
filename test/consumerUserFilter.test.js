'use strict';

/**
 * /api/auth/users y /api/auth/user-query pasaban el body o el query string tal
 * cual a User.find(): sin sesión, `{}` o `{ email: { $ne: null } }` devolvía
 * todos los consumidores. Se llaman con y sin sesión (app del consumidor,
 * registro público), así que hay dos carriles:
 *   - staff con sesión válida: filtros por campos del modelo, valores simples.
 *   - sin sesión: solo email exacto, y sin `notes`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const STAFF = '111111111111111111111111';
const admins = { [STAFF]: { tokenVersion: 3, active: true } };
stub('models/AdminUser.js', {
  findById: (id) => ({ select: () => ({ lean: async () => admins[id] ?? null }) }),
});

const userFinds = [];
const redis = { gets: [], sets: [] };
stub('models/User.js', {
  find: async (filter, projection) => {
    userFinds.push({ filter, projection });
    return [{ email: 'a@b.com' }];
  },
});
stub('models/Event.js', {});
stub('models/Receivers.js', {});
stub('helpers/jwt.js', { generateJWT: async () => 'tok' });
stub('helpers/goWorker.js', async () => ({}));
stub('helpers/logger.js', { error: () => {}, warn: () => {}, info: () => {} });
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => ({
    get: async (k) => { redis.gets.push(k); return null; },
    set: async (k) => { redis.sets.push(k); },
    expire: async () => {},
  }),
});

const { buildUserFilter, parseQueryString, isStaffSession } = require('../helpers/consumerUserFilter');
const { showAllUsers, lookupUsers, getListOfUsers } = require('../controller/auth');
const { optionalJWT } = require('../middlewares/optionalJWT');

const withOrigin = (origin) => ({ header: (n) => (n.toLowerCase() === 'origin' ? origin : undefined) });
const staffReq = (extra) => ({ uid: STAFF, tokenVersion: 3, ...withOrigin('https://admin.devitrak.net'), ...extra });
const anonReq = (extra) => ({ ...withOrigin('https://app.devitrak.net'), ...extra });
const dashboardNoSession = (extra) => ({ ...withOrigin('https://admin.devitrak.net'), ...extra });
const res = () => {
  const r = {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const lastFind = () => userFinds.at(-1);

// ── buildUserFilter ─────────────────────────────────────────────────────────

test('sin sesión: email exacto pasa', () => {
  assert.deepEqual(buildUserFilter({ email: 'a@b.com' }, { authenticated: false }), { email: 'a@b.com' });
});

test('sin sesión: vacío → null (lista vacía, no todos)', () => {
  assert.equal(buildUserFilter(undefined, { authenticated: false }), null);
  assert.equal(buildUserFilter({}, { authenticated: false }), null);
});

test('sin sesión: otros campos o email vacío → 401', () => {
  for (const input of [{ name: 'Ana' }, { email: 'a@b.com', name: 'Ana' }, { email: '  ' }]) {
    assert.throws(() => buildUserFilter(input, { authenticated: false }), { status: 401 });
  }
});

test('operadores Mongo y campos fuera del modelo → 400, con o sin sesión', () => {
  for (const authenticated of [true, false]) {
    assert.throws(() => buildUserFilter({ email: { $ne: null } }, { authenticated }), { status: 400 });
    assert.throws(() => buildUserFilter({ $where: '1' }, { authenticated }), { status: 400 });
    assert.throws(() => buildUserFilter({ 'notes.notes': 'x' }, { authenticated }), { status: 400 });
    assert.throws(() => buildUserFilter({ email: ['a', 'b'] }, { authenticated }), { status: 400 });
  }
});

test('con sesión: vacío sigue trayendo todo y acepta varios campos', () => {
  assert.deepEqual(buildUserFilter(undefined, { authenticated: true }), {});
  assert.deepEqual(
    buildUserFilter({ event_providers: 'E', company_providers: 'C' }, { authenticated: true }),
    { event_providers: 'E', company_providers: 'C' },
  );
});

test('parseQueryString: null no revienta y decodifica', () => {
  assert.deepEqual(parseQueryString(null), {});
  assert.deepEqual(parseQueryString('email=a%40b.com'), { email: 'a@b.com' });
});

// ── isStaffSession ──────────────────────────────────────────────────────────

test('isStaffSession: solo con tokenVersion vigente de un AdminUser activo', async () => {
  assert.equal(await isStaffSession(staffReq()), true);
  assert.equal(await isStaffSession(staffReq({ tokenVersion: 2 })), false, 'sesión cerrada');
  assert.equal(await isStaffSession({ uid: '999999999999999999999999', tokenVersion: 0 }), false, 'token de consumidor');
  assert.equal(await isStaffSession({}), false);
});

// ── showAllUsers (GET/POST /users, POST /user-query) ────────────────────────

test('showAllUsers sin sesión: por email, sin notes', async () => {
  const r = res();
  await showAllUsers(anonReq({ body: { email: 'a@b.com' } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(lastFind(), { filter: { email: 'a@b.com' }, projection: '-notes' });
});

test('showAllUsers sin sesión: GET /users sin body ya no lista a todos (lista vacía)', async () => {
  const before = userFinds.length;
  const r = res();
  await showAllUsers(anonReq({ body: undefined }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.users, []);
  assert.equal(userFinds.length, before, 'no debe consultar');
});

test('showAllUsers sin sesión: inyección de operador → 400 sin consultar', async () => {
  const before = userFinds.length;
  const r = res();
  await showAllUsers(anonReq({ body: { email: { $ne: null } } }), r);
  assert.equal(r.code, 400);
  assert.equal(userFinds.length, before);
});

test('showAllUsers con sesión: lista completa con todos los campos', async () => {
  const r = res();
  await showAllUsers(staffReq({ body: undefined }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(lastFind(), { filter: {}, projection: null });
});

// ── getListOfUsers (GET /user-query) ────────────────────────────────────────

test('getListOfUsers con sesión: evento+compañía usa la caché de siempre', async () => {
  const r = res();
  await getListOfUsers(staffReq({ _parsedUrl: { query: 'event_providers=E1&company_providers=C1' } }), r);
  assert.equal(r.code, 200);
  assert.equal(redis.gets.at(-1), 'event=E1&company=C1');
  assert.deepEqual(lastFind().filter, { event_providers: 'E1', company_providers: 'C1' });
});

test('getListOfUsers sin sesión: por email, sin caché compartida', async () => {
  const gets = redis.gets.length;
  const r = res();
  await getListOfUsers(anonReq({ _parsedUrl: { query: 'email=a@b.com' } }), r);
  assert.equal(r.code, 200);
  assert.equal(redis.gets.length, gets, 'no debe leer "event=null&company=null"');
  assert.deepEqual(lastFind(), { filter: { email: 'a@b.com' }, projection: '-notes' });
});

test('getListOfUsers sin sesión: lista de evento → 401', async () => {
  const r = res();
  await getListOfUsers(anonReq({ _parsedUrl: { query: 'event_providers=E1&company_providers=C1' } }), r);
  assert.equal(r.code, 401);
});

test('getListOfUsers: sin query string ya no da 500', async () => {
  const r = res();
  await getListOfUsers(anonReq({ _parsedUrl: { query: null } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.users, []);
});

test('dashboard sin sesión: GET /users sin filtro → 401, no lista vacía', async () => {
  const r = res();
  await showAllUsers(dashboardNoSession({ body: undefined }), r);
  assert.equal(r.code, 401);
});

// ── origen: admin.devitrak.net es staff, app.devitrak.net es público ─────────

test('dashboard sin sesión: GET/POST /users → 401 aunque busque por email', async () => {
  const before = userFinds.length;
  const r = res();
  await showAllUsers(dashboardNoSession({ body: { email: 'a@b.com' } }), r);
  assert.equal(r.code, 401);
  assert.equal(userFinds.length, before);
});

test('dashboard sin sesión: GET /user-query → 401 aunque busque por email', async () => {
  const r = res();
  await getListOfUsers(dashboardNoSession({ _parsedUrl: { query: 'email=a@b.com' } }), r);
  assert.equal(r.code, 401);
});

test('dashboard sin sesión: POST /user-query por email sigue (página /attendance-confirmation)', async () => {
  const r = res();
  await lookupUsers(dashboardNoSession({ body: { email: 'a@b.com' } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(lastFind(), { filter: { email: 'a@b.com' }, projection: '-notes' });
});

test('dashboard sin sesión: POST /user-query con otros filtros → 401', async () => {
  const r = res();
  await lookupUsers(dashboardNoSession({ body: { event_providers: 'E1' } }), r);
  assert.equal(r.code, 401);
});

test('app.devitrak.net sin sesión: POST /users por email pasa', async () => {
  const r = res();
  await showAllUsers(anonReq({ body: { email: 'a@b.com' } }), r);
  assert.equal(r.code, 200);
});

test('STAFF_ORIGINS sustituye la lista de orígenes del dashboard', async () => {
  process.env.STAFF_ORIGINS = 'http://localhost:5522';
  try {
    const r1 = res();
    await showAllUsers({ ...withOrigin('http://localhost:5522'), body: { email: 'a@b.com' } }, r1);
    assert.equal(r1.code, 401);
    const r2 = res();
    await showAllUsers(dashboardNoSession({ body: { email: 'a@b.com' } }), r2);
    assert.equal(r2.code, 200, 'admin.devitrak.net ya no está en la lista configurada');
  } finally {
    delete process.env.STAFF_ORIGINS;
  }
});

// ── rutas ───────────────────────────────────────────────────────────────────

test('routes/auth.js: las cuatro rutas de listado pasan por optionalJWT', () => {
  const router = require('../routes/auth');
  for (const [method, p] of [['get', '/users'], ['post', '/users'], ['post', '/user-query'], ['get', '/user-query']]) {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    assert.ok(layer, `${method} ${p} no registrada`);
    assert.ok(layer.route.stack.map((l) => l.handle).includes(optionalJWT), `${method} ${p} sin optionalJWT`);
  }
});

test('routes/auth.js: POST /user-query usa lookupUsers (carril público también desde el dashboard)', () => {
  const router = require('../routes/auth');
  const layer = router.stack.find((l) => l.route && l.route.path === '/user-query' && l.route.methods.post);
  assert.ok(layer.route.stack.map((l) => l.handle).includes(lookupUsers));
});
