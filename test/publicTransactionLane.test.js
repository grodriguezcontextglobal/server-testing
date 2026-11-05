'use strict';

/**
 * POST /transaction, POST /save-transaction y DELETE /remove-duplicate-transaction/:id
 * (y sus gemelas de /api/stripe) los llama la app del consumidor sin sesión.
 * Antes el body iba tal cual a Transaction.find()/new Transaction() y cualquier
 * id se podía borrar. Ahora hay dos carriles:
 *   - staff con sesión válida: igual que siempre.
 *   - sin sesión: filtros acotados, lista blanca al guardar, solo borrar duplicados.
 *   - dashboard sin sesión: 401.
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
stub('models/AdminUser.js', {
  findById: (id) => ({
    select: () => ({ lean: async () => (id === STAFF ? { tokenVersion: 3, active: true } : null) }),
  }),
});

const db = { finds: [], findOnes: [], saved: [], deleted: [], findOneResult: null, byId: {} };
function Transaction(doc) { this.doc = doc; }
Transaction.prototype.save = async function save() { db.saved.push(this.doc); return { ...this.doc }; };
Transaction.find = async (filter, projection) => { db.finds.push({ filter, projection }); return []; };
Transaction.findOne = async (filter, projection) => {
  db.findOnes.push({ filter, projection });
  return db.findOneResult;
};
Transaction.findById = async (id) => db.byId[id] ?? null;
Transaction.findByIdAndDelete = async (id) => { db.deleted.push(id); return {}; };
stub('models/Transaction.js', Transaction);
stub('database/cacheMemoryConfig.js', { clientRedis: async () => ({ del: () => {} }) });
stub('helpers/logger.js', { error: () => {}, warn: () => {}, info: () => {} });
stub('helpers/goWorker.js', async () => ({}));

const {
  buildPublicTransactionList,
  buildPublicTransactionDoc,
} = require('../helpers/publicTransactionLane');
const {
  getListOfAllSavedTransaction,
  saveTransaction,
  removeDuplicateEntry,
} = require('../controller/transaction');

const withOrigin = (origin) => ({ header: (n) => (n.toLowerCase() === 'origin' ? origin : undefined) });
const staffReq = (extra) => ({ uid: STAFF, tokenVersion: 3, ...withOrigin('https://admin.devitrak.net'), ...extra });
const appReq = (extra) => ({ ...withOrigin('https://app.devitrak.net'), ...extra });
const dashboardNoSession = (extra) => ({ ...withOrigin('https://admin.devitrak.net'), ...extra });
const res = () => {
  const r = {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const reset = () => {
  db.finds = []; db.findOnes = []; db.saved = []; db.deleted = [];
  db.findOneResult = null; db.byId = {};
};

// Lo que manda hoy la app (devitrak, origin/main) a POST /transaction/transaction.
const APP_LIST_BODIES = [
  { 'consumerInfo.email': 'a@b.com', event_id: 'E1' },                       // OptionsMainPage
  { 'consumerInfo.email': 'a@b.com', created_at: { $gte: 1700000000000 } },  // OrderHistory
  { company: 'C1', event_id: 'E1', 'consumerInfo.email': 'a@b.com' },        // PaymentInformation
  { event_id: 'E1' },                                                        // DisplayQRCode (dedupe)
];

// Lo que manda la app a POST /transaction/save-transaction (src/classes/Transaction.js).
const appDoc = () => ({
  paymentIntent: 'pi_123',
  clientSecret: '_client_secret=abc',
  device: [{ deviceType: 'undefined', deviceNeeded: 1 }],
  consumerInfo: { id: 'U1', uid: 'U1', email: 'a@b.com', name: 'Ana' },
  provider: 'Acme',
  eventSelected: 'Fest',
  event_id: 'E1',
  company: 'C1',
  date: '2026-10-15T10:00:00.000Z',
  active: true,
});

// ── helper: listas ──────────────────────────────────────────────────────────

test('lista sin sesión: las 4 peticiones reales de la app pasan', () => {
  for (const body of APP_LIST_BODIES) assert.doesNotThrow(() => buildPublicTransactionList(body));
});

test('lista sin sesión: con email ve lo suyo sin clientSecret; solo evento → id y paymentIntent', () => {
  assert.equal(buildPublicTransactionList(APP_LIST_BODIES[0]).projection, '-clientSecret');
  assert.equal(buildPublicTransactionList({ event_id: 'E1' }).projection, 'paymentIntent event_id');
});

test('lista sin sesión: vacío, operadores o campos fuera de la lista → 400', () => {
  for (const body of [
    undefined,
    {},
    { company: 'C1' },
    { paymentIntent: 'pi_1' },
    { $where: '1' },
    { 'consumerInfo.email': { $ne: null } },
    { 'consumerInfo.email': 'a@b.com', 'consumerInfo.id': 'U1' },
    { event_id: 'E1', created_at: { $where: '1' } },
    { event_id: 'E1', active: 'true' },
  ]) {
    assert.throws(() => buildPublicTransactionList(body), { status: 400 }, JSON.stringify(body));
  }
});

// ── helper: guardar ─────────────────────────────────────────────────────────

test('guardar sin sesión: el payload de la app pasa; type/created_at fuera, active siempre true', () => {
  const doc = buildPublicTransactionDoc({ ...appDoc(), active: false, type: 'subscription', created_at: 1 });
  assert.equal(doc.active, true);
  assert.equal('type' in doc, false);
  assert.equal('created_at' in doc, false);
  assert.equal(doc.paymentIntent, 'pi_123');
});

test('guardar sin sesión: faltan campos o device mal formado → 400', () => {
  for (const mutate of [
    (d) => delete d.paymentIntent,
    (d) => { d.consumerInfo = { id: 'U1' }; },
    (d) => { d.device = []; },
    (d) => { d.device = 'x'; },
    (d) => { d.event_id = { $ne: null }; },
  ]) {
    const d = appDoc();
    mutate(d);
    assert.throws(() => buildPublicTransactionDoc(d), { status: 400 });
  }
});

// ── controlador: listar ─────────────────────────────────────────────────────

test('listar: staff con sesión sigue pasando el body tal cual', async () => {
  reset();
  const body = { company: 'C1', active: { $in: [true] } };
  const r = res();
  await getListOfAllSavedTransaction(staffReq({ body }), r);
  assert.equal(r.code, 201);
  assert.deepEqual(db.finds[0], { filter: body, projection: undefined });
});

test('listar: la app sin sesión va por el carril acotado', async () => {
  reset();
  const r = res();
  await getListOfAllSavedTransaction(appReq({ body: { event_id: 'E1' } }), r);
  assert.equal(r.code, 201);
  assert.deepEqual(db.finds[0], { filter: { event_id: 'E1' }, projection: 'paymentIntent event_id' });
});

test('listar: sin sesión y body vacío → 400 (antes, todas las transacciones)', async () => {
  reset();
  const r = res();
  await getListOfAllSavedTransaction(appReq({ body: {} }), r);
  assert.equal(r.code, 400);
  assert.equal(db.finds.length, 0);
});

test('listar: dashboard sin sesión → 401, aunque el filtro sea válido para la app', async () => {
  reset();
  const r = res();
  await getListOfAllSavedTransaction(dashboardNoSession({ body: { event_id: 'E1' } }), r);
  assert.equal(r.code, 401);
  assert.equal(db.finds.length, 0);
});

// ── controlador: guardar ────────────────────────────────────────────────────

test('guardar: la app sin sesión guarda la versión saneada', async () => {
  reset();
  const r = res();
  await saveTransaction(appReq({ body: { ...appDoc(), type: 'subscription' } }), r);
  assert.equal(r.code, 201);
  assert.equal(db.saved.length, 1);
  assert.equal('type' in db.saved[0], false);
});

test('guardar: si ya existe (mismo paymentIntent, evento y email) devuelve la existente', async () => {
  reset();
  db.findOneResult = { id: 'T1', paymentIntent: 'pi_123' };
  const r = res();
  await saveTransaction(appReq({ body: appDoc() }), r);
  assert.equal(r.code, 200);
  assert.equal(db.saved.length, 0);
  assert.deepEqual(db.findOnes[0].filter, {
    paymentIntent: 'pi_123', event_id: 'E1', 'consumerInfo.email': 'a@b.com',
  });
  assert.equal(db.findOnes[0].projection, '-clientSecret');
});

test('guardar: staff con sesión guarda el body tal cual, sin dedupe', async () => {
  reset();
  db.findOneResult = { id: 'T1' };
  const body = { ...appDoc(), type: 'subscription' };
  const r = res();
  await saveTransaction(staffReq({ body }), r);
  assert.equal(r.code, 201);
  assert.deepEqual(db.saved[0], body);
  assert.equal(db.findOnes.length, 0);
});

test('guardar: dashboard sin sesión → 401', async () => {
  reset();
  const r = res();
  await saveTransaction(dashboardNoSession({ body: appDoc() }), r);
  assert.equal(r.code, 401);
  assert.equal(db.saved.length, 0);
});

// ── controlador: borrar duplicado ───────────────────────────────────────────

const T_NEW = '222222222222222222222222';
const tx = { _id: T_NEW, paymentIntent: 'pi_123', event_id: 'E1', company: 'C1', consumerInfo: { id: 'U1' } };

test('borrar: sin sesión y sin gemela más antigua → 409, no borra', async () => {
  reset();
  db.byId[T_NEW] = tx;
  const r = res();
  await removeDuplicateEntry(appReq({ params: { id: T_NEW } }), r);
  assert.equal(r.code, 409);
  assert.equal(db.deleted.length, 0);
  assert.deepEqual(db.findOnes[0].filter, { _id: { $lt: T_NEW }, paymentIntent: 'pi_123', event_id: 'E1' });
});

test('borrar: sin sesión con gemela más antigua → borra (dedupe de la app)', async () => {
  reset();
  db.byId[T_NEW] = tx;
  db.findOneResult = { _id: '111111111111111111111110' };
  const r = res();
  await removeDuplicateEntry(appReq({ params: { id: T_NEW } }), r);
  assert.equal(r.code, 201);
  assert.deepEqual(db.deleted, [T_NEW]);
});

test('borrar: staff con sesión borra sin comprobar gemela', async () => {
  reset();
  db.byId[T_NEW] = tx;
  const r = res();
  await removeDuplicateEntry(staffReq({ params: { id: T_NEW } }), r);
  assert.equal(r.code, 201);
  assert.deepEqual(db.deleted, [T_NEW]);
  assert.equal(db.findOnes.length, 0);
});

test('borrar: id inexistente o mal formado → 404 (antes se quedaba colgado)', async () => {
  for (const id of ['333333333333333333333333', 'nope']) {
    reset();
    const r = res();
    await removeDuplicateEntry(appReq({ params: { id } }), r);
    assert.equal(r.code, 404, id);
  }
});

test('borrar: dashboard sin sesión → 401', async () => {
  reset();
  db.byId[T_NEW] = tx;
  const r = res();
  await removeDuplicateEntry(dashboardNoSession({ params: { id: T_NEW } }), r);
  assert.equal(r.code, 401);
  assert.equal(db.deleted.length, 0);
});

// ── rutas ───────────────────────────────────────────────────────────────────

test('routes/transaction.js: las 3 rutas de la app llevan optionalJWT (sin él no hay carril staff)', () => {
  const { optionalJWT } = require('../middlewares/optionalJWT');
  const router = require('../routes/transaction');
  for (const [method, routePath] of [
    ['post', '/transaction'],
    ['post', '/save-transaction'],
    ['delete', '/remove-duplicate-transaction/:id'],
  ]) {
    const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
    assert.ok(layer.route.stack.map((l) => l.handle).includes(optionalJWT), `${method} ${routePath}`);
  }
});
