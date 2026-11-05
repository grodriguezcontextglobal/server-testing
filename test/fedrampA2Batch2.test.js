'use strict';

/**
 * FedRAMP A2 lote 2 (2026-10-27): rutas que el dashboard llama antes de que
 * exista la sesión (login, invitación, portal de familia). No se pueden cerrar
 * con validateJWT, así que el controlador responde menos a quien no la trae.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed-a2';
const SEED = process.env.SECRET_JWT_SEED;

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

// ── dobles ──────────────────────────────────────────────────────────────────

const executed = [];
let sqlRows = [];
const fakeConnection = {
  execute: async (sql, values) => { executed.push({ sql, values }); return [sqlRows]; },
  query: async (sql, values) => { executed.push({ sql, values }); return [sqlRows]; },
};
stub('mysql/database/config.js', () => fakeConnection);
stub('helpers/logger.js', { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} });

const deletedKeys = [];
stub('database/cacheMemoryConfig.js', { clientRedis: async () => ({ del: (k) => deletedKeys.push(k) }) });

const adminUsers = new Map(); // id → { _id, email, tokenVersion }
const selectable = (doc) => ({ select: async () => doc, then: (r, j) => Promise.resolve(doc).then(r, j) });
stub('models/AdminUser.js', {
  findById: (id) => {
    const doc = adminUsers.get(String(id)) || null;
    const q = Promise.resolve(doc);
    q.select = () => Promise.resolve(doc);
    return q;
  },
});

const acceptances = new Map(); // id → { _id, email, staff_id }
const saved = [];
const updates = [];
function FakeDevitrakApp(fields) { Object.assign(this, fields, { _id: 'new-acc' }); }
FakeDevitrakApp.prototype.save = async function () { saved.push({ ...this }); };
FakeDevitrakApp.exists = async ({ email }) => [...acceptances.values()].some((a) => a.email === email);
FakeDevitrakApp.findById = (id) => Promise.resolve(acceptances.get(String(id)) || null);
FakeDevitrakApp.findByIdAndUpdate = async (id, update) => { updates.push({ id, update }); };
stub('models/DevitrakApp.js', FakeDevitrakApp);

const res = () => {
  const r = { cookies: [] };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.clearCookie = () => r;
  return r;
};

// ── términos de Devitrak ────────────────────────────────────────────────────

const { acceptancePoliciesAndTermsApp, updateAcceptanceByAddingStaffMemberID } = require('../controller/devitrakApp');

test('new_acceptance: solo guarda los campos del modelo que pone el cliente', async () => {
  saved.length = 0;
  const r = res();
  await acceptancePoliciesAndTermsApp({ body: {
    signature: 'Ana', email: 'ana@x.com', staff_id: 'attacker', date: '2000-01-01',
    documentsAndPolicies: [{ documentName: 'ToS', url: 'https://x/tos', extra: 1 }],
  } }, r);
  assert.equal(r.code, 201);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].staff_id, undefined, 'staff_id no viene del body');
  assert.equal(saved[0].date, undefined, 'date no viene del body');
  assert.deepEqual(saved[0].documentsAndPolicies, [{ documentName: 'ToS', url: 'https://x/tos' }]);
});

test('new_acceptance: si ya existe, no devuelve el registro de esa persona', async () => {
  acceptances.set('a1', { _id: 'a1', email: 'ya@x.com' });
  const r = res();
  await acceptancePoliciesAndTermsApp({ body: { signature: 'X', email: 'ya@x.com' } }, r);
  assert.equal(r.code, 201);
  assert.equal(r.body.info, undefined);
  assert.equal(r.body.acceptanceInfo, undefined);
});

test('PATCH /devitrak/:id: no ata una cuenta de otro email', async () => {
  updates.length = 0;
  acceptances.set('a2', { _id: 'a2', email: 'victima@x.com' });
  adminUsers.set('u-att', { _id: 'u-att', email: 'atacante@x.com' });
  const r = res();
  await updateAcceptanceByAddingStaffMemberID({ params: { id: 'a2' }, body: { email: 'victima@x.com', staff_id: 'u-att' } }, r);
  assert.equal(r.code, 404);
  assert.equal(updates.length, 0);
});

test('PATCH /devitrak/:id: ata cuando aceptación, email y cuenta coinciden', async () => {
  updates.length = 0;
  acceptances.set('a3', { _id: 'a3', email: 'Nuevo@x.com' });
  adminUsers.set('u-new', { _id: 'u-new', email: 'nuevo@x.com' });
  const r = res();
  await updateAcceptanceByAddingStaffMemberID({ params: { id: 'a3' }, body: { email: 'nuevo@x.com', staff_id: 'u-new' } }, r);
  assert.equal(r.code, 201);
  assert.deepEqual(updates, [{ id: 'a3', update: { staff_id: 'u-new' } }]);
});

test('PATCH /devitrak/:id: una aceptación ya atada no se reasigna', async () => {
  updates.length = 0;
  acceptances.set('a4', { _id: 'a4', email: 'dos@x.com', staff_id: 'u-first' });
  adminUsers.set('u-second', { _id: 'u-second', email: 'dos@x.com' });
  const r = res();
  await updateAcceptanceByAddingStaffMemberID({ params: { id: 'a4' }, body: { email: 'dos@x.com', staff_id: 'u-second' } }, r);
  assert.equal(r.code, 409);
  assert.equal(updates.length, 0);
});

// ── logout ──────────────────────────────────────────────────────────────────

const { logoutUser } = require('../controller/admin');
const logoutReq = (token, body = {}) => ({ cookies: {}, headers: token ? { 'x-token': token } : {}, body });

test('logout: un token con firma falsa es 401 y no borra ninguna sesión', async () => {
  deletedKeys.length = 0;
  const forged = jwt.sign({ uid: 'victima' }, 'otra-semilla');
  const r = res();
  await logoutUser(logoutReq(forged), r);
  assert.equal(r.code, 401);
  assert.deepEqual(deletedKeys, []);
});

test('logout: un token propio caducado sí cierra su sesión', async () => {
  deletedKeys.length = 0;
  const expired = jwt.sign({ uid: 'u1', exp: Math.floor(Date.now() / 1000) - 60 }, SEED);
  const r = res();
  await logoutUser(logoutReq(expired, { uid: 'otro' }), r);
  assert.equal(r.code, 201);
  assert.deepEqual(deletedKeys, ['staff_session:u1'], 'cierra la del token, no la del body');
});

test('logout: solo con uid en el body es 401 y no borra ninguna sesión', async () => {
  deletedKeys.length = 0;
  const r = res();
  await logoutUser(logoutReq(null, { uid: 'victima' }), r);
  assert.equal(r.code, 401);
  assert.deepEqual(deletedKeys, []);
});

// ── consulting-member ───────────────────────────────────────────────────────

const { consultingStaffMemberInformation } = require('../mysql/controllers/staff');

test('consulting-member sin sesión: solo staff_id por email exacto', async () => {
  executed.length = 0;
  sqlRows = [{ staff_id: 7 }];
  const r = res();
  await consultingStaffMemberInformation({ body: { email: 'a@x.com', first_name: 'A' } }, r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.member, [{ staff_id: 7 }]);
  assert.match(executed[0].sql, /SELECT staff_id FROM staff_member WHERE email = \?/);
  assert.deepEqual(executed[0].values, ['a@x.com']);
});

test('consulting-member sin sesión: sin email es 400 (no filtra por otras columnas)', async () => {
  executed.length = 0;
  const r = res();
  await consultingStaffMemberInformation({ body: { first_name: 'A' } }, r);
  assert.equal(r.code, 400);
  assert.equal(executed.length, 0);
});

test('consulting-member con sesión: mantiene la búsqueda completa', async () => {
  executed.length = 0;
  sqlRows = [{ staff_id: 7, first_name: 'A' }];
  const r = res();
  await consultingStaffMemberInformation({ uid: 'u1', body: { first_name: 'A' } }, r);
  assert.equal(r.code, 200);
  assert.match(executed[0].sql, /SELECT \* FROM staff_member WHERE first_name=\?/);
});

// ── sessionIfValid ──────────────────────────────────────────────────────────

const { sessionIfValid } = require('../middlewares/sessionIfValid');
const run = async (token) => {
  const req = { header: (h) => (h === 'x-token' ? token : undefined) };
  let nexted = false;
  await sessionIfValid(req, res(), () => { nexted = true; });
  return { req, nexted };
};

test('sessionIfValid: token válido y vigente → request.uid', async () => {
  adminUsers.set('u9', { _id: 'u9', email: 'n@x.com', tokenVersion: 3 });
  const { req, nexted } = await run(jwt.sign({ uid: 'u9', tokenVersion: 3 }, SEED));
  assert.ok(nexted);
  assert.equal(req.uid, 'u9');
});

test('sessionIfValid: revocado, caducado o falso → anónima, nunca 401', async () => {
  const tokens = [
    jwt.sign({ uid: 'u9', tokenVersion: 2 }, SEED),
    jwt.sign({ uid: 'u9', tokenVersion: 3, exp: Math.floor(Date.now() / 1000) - 60 }, SEED),
    jwt.sign({ uid: 'u9', tokenVersion: 3 }, 'otra-semilla'),
  ];
  for (const token of tokens) {
    const { req, nexted } = await run(token);
    assert.ok(nexted);
    assert.equal(req.uid, undefined);
  }
});

// ── my-devices ──────────────────────────────────────────────────────────────

const { retrieveMyDevices } = require('../mysql/controllers/members');

test('my-devices: el mismo 404 exista o no el alumno, y sea o no menor', async () => {
  sqlRows = [{ member_id: 1, minor: 1, email: 'kid@x.com', parent_guardian_email: 'mom@x.com' }];
  const minorWrongEmail = res();
  await retrieveMyDevices({ body: { email: 'kid@x.com', external_id: 'S1' } }, minorWrongEmail);
  sqlRows = [];
  const missing = res();
  await retrieveMyDevices({ body: { email: 'nadie@x.com', external_id: 'S2' } }, missing);
  assert.equal(minorWrongEmail.code, 404);
  assert.equal(missing.code, 404);
  assert.deepEqual(minorWrongEmail.body, missing.body);
});
