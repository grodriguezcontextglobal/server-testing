'use strict';

/**
 * /api/transaction acotado a la compañía (FedRAMP A8, 2026-10-27).
 *
 *   - Cada ruta con sesión de staff pasa por requireStripeOwnership; en las de
 *     dos carriles, solo cuando hay sesión (la app de consumidor sigue igual).
 *   - update-transaction solo cambia `active`; update-multiple-documents exige
 *     company en el filtro y solo cambia `active`.
 *   - El listado del staff rechaza operadores que ejecutan código; el GET usa
 *     la compañía que deja la ruta, también en la clave de caché.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequireStripeOwnership } = require('../middlewares/requireStripeOwnership');

const root = path.resolve(__dirname, '..');
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

// ═══ rutas ══════════════════════════════════════════════════════════════════

test('las rutas de staff de /api/transaction llevan la guarda de compañía', () => {
  const router = require('../routes/transaction');
  const GUARDED = [
    'POST /save-transaction', 'POST /save-transaction-admin-dashboard', 'POST /save-transaction-template-no-regular-user',
    'POST /transaction', 'GET /transaction', 'PATCH /update-transaction/:id', 'DELETE /remove-duplicate-transaction/:id',
    'GET /subscriptions/:id', 'POST /update-multiple-documents', 'POST /check-and-release-deposit-transactions',
  ];
  for (const key of GUARDED) {
    const [method, p] = key.split(' ');
    const layer = router.stack.find((l) => l.route?.path === p && l.route.methods[method.toLowerCase()]);
    assert.ok(layer, key);
    const names = layer.route.stack.map((l) => l.handle.name);
    assert.ok(names.includes('requireStripeOwnership'), key);
    assert.ok(names.indexOf('requireStripeOwnership') < names.length - 1, `${key}: la guarda va antes del controlador`);
  }
});

// ═══ opciones nuevas de la guarda ═══════════════════════════════════════════

const guard = createRequireStripeOwnership({
  findAdmin: async () => null,
  resolveCompany: (req) => req.headers['x-company-id'] ?? null,
  // `staff` es empleado de A: la guarda exige pertenencia desde 2026-11-03.
  findCompany: async (id) => ({ [A]: { _id: A, company_name: 'Acme', employees: [{ userId: 'staff' }] } })[id] ?? null,
  findStripeCompaniesByName: async () => [],
  findStripeCompany: async () => null,
  findTransaction: async () => null,
  findStripeTransaction: async () => null,
  stripeApi: {},
  connectedAccountOf: () => null,
  logger: { warn: () => {}, error: () => {} },
});

async function run(getId, opts, { uid = 'staff', company = A, query = {}, body = {} } = {}) {
  process.env.STRIPE_OWNERSHIP_MODE = 'enforce';
  const req = { uid, query, body, headers: company ? { 'x-company-id': company } : {}, originalUrl: '/x', method: 'GET' };
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  try {
    await guard('company', getId, opts)(req, res, () => { passed = true; });
  } finally {
    delete process.env.STRIPE_OWNERSHIP_MODE;
  }
  return { passed, code: res.code, req };
}

test('onlyWithSession: sin sesión de staff no comprueba nada (carril de la app de consumidor)', async () => {
  const r = await run((req) => req.body.company, { onlyWithSession: true }, { uid: null, company: null, body: { company: B } });
  assert.equal(r.passed, true);
  const staff = await run((req) => req.body.company, { onlyWithSession: true }, { body: { company: B } });
  assert.equal(staff.code, 404);
});

test('injectCompany: la query sin company recibe la del contexto donde diga la ruta', async () => {
  const opts = { injectCompany: (req, id) => { req.transactionScopeCompany = id; } };
  const r = await run((req) => req.query.company, opts, { query: { paymentIntent: 'pi_1' } });
  assert.equal(r.passed, true);
  assert.equal(r.req.transactionScopeCompany, A);
  assert.equal((await run((req) => req.query.company, opts, { query: { company: B } })).code, 404);
});

// ═══ controladores ══════════════════════════════════════════════════════════

function loadTransactionController({ Transaction, staff = true, redis = {} }) {
  const p = (rel) => path.join(root, rel);
  const stubs = {
    'models/Transaction.js': Transaction,
    'database/cacheMemoryConfig.js': { clientRedis: async () => ({ get: async () => null, set: () => {}, expire: () => {}, del: () => {}, ...redis }) },
    'helpers/logger.js': { error: () => {}, warn: () => {}, info: () => {} },
    'helpers/consumerUserFilter.js': { isStaffSession: async () => staff, isStaffOrigin: () => staff },
  };
  const keys = [...Object.keys(stubs), 'controller/transaction.js'];
  const saved = Object.fromEntries(keys.map((k) => [k, require.cache[p(k)]]));
  for (const [k, exports] of Object.entries(stubs)) require.cache[p(k)] = { id: p(k), filename: p(k), loaded: true, exports };
  delete require.cache[p('controller/transaction.js')];
  const ctrl = require(p('controller/transaction.js'));
  const restore = () => {
    for (const k of keys) {
      if (saved[k]) require.cache[p(k)] = saved[k];
      else delete require.cache[p(k)];
    }
  };
  return { ctrl, restore };
}
const mockRes = () => ({ status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test('updateTransaction: solo `active`; el resto se ignora y se avisa', async () => {
  const writes = [];
  const Transaction = {
    findById: async (id) => ({ _id: id }),
    findByIdAndUpdate: async (id, update) => { writes.push(update); return { _id: id }; },
  };
  const { ctrl, restore } = loadTransactionController({ Transaction });
  try {
    const res = mockRes();
    await ctrl.updateTransaction({ params: { id: 't1' }, body: { id: 't1', active: false, company: B, paymentIntent: 'pi_x' } }, res);
    assert.equal(res.code, 201);
    assert.deepEqual(writes, [{ $set: { active: false } }]);
    assert.deepEqual(res.body.ignored_fields, ['company', 'paymentIntent']);

    const bad = mockRes();
    await ctrl.updateTransaction({ params: { id: 't1' }, body: { company: B } }, bad);
    assert.equal(bad.code, 400);
    assert.equal(writes.length, 1);
  } finally {
    restore();
  }
});

test('updateMultipleDocuments: exige company, solo campos conocidos en find y solo `active` en update', async () => {
  const calls = [];
  const Transaction = { updateMany: async (filter, update) => { calls.push({ filter, update }); return { modifiedCount: 3 }; } };
  const { ctrl, restore } = loadTransactionController({ Transaction });
  try {
    const ok = mockRes();
    await ctrl.updateMultipleDocuments({ body: { find: { eventSelected: 'Expo', company: A }, update: { active: false } } }, ok);
    assert.equal(ok.code, 201);
    assert.deepEqual(calls, [{ filter: { eventSelected: 'Expo', company: A }, update: { $set: { active: false } } }]);

    for (const body of [
      { find: {}, update: { active: false } },
      { find: { eventSelected: 'Expo' }, update: { active: false } },
      { find: { company: A, paymentIntent: 'pi' }, update: { active: false } },
      { find: { company: A }, update: { active: false, company: B } },
      { find: { company: A }, update: { $set: { company: B } } },
      { find: { company: A }, update: { active: 'no' } },
    ]) {
      const res = mockRes();
      await ctrl.updateMultipleDocuments({ body }, res);
      assert.equal(res.code, 400, JSON.stringify(body));
    }
    assert.equal(calls.length, 1);

    await ctrl.updateMultipleDocuments({ body: { find: { company: A, eventSelected: { $ne: null } }, update: { active: false } } }, mockRes());
    assert.deepEqual(calls[1].filter.eventSelected, { $eq: { $ne: null } }, 'operadores neutralizados en find');
  } finally {
    restore();
  }
});

test('listado del staff: $where, $expr y compañía rechazados; $in sigue valiendo', async () => {
  const filters = [];
  const Transaction = { find: async (f) => { filters.push(f); return []; } };
  const { ctrl, restore } = loadTransactionController({ Transaction });
  try {
    for (const body of [{ $where: 'sleep(1000)' }, { company: A, x: { $expr: { $gt: ['$a', 1] } } }, { $or: [{ $where: '1' }] }]) {
      const res = mockRes();
      await ctrl.getListOfAllSavedTransaction({ body, headers: {} }, res);
      assert.equal(res.code, 400, JSON.stringify(body));
    }
    const res = mockRes();
    await ctrl.getListOfAllSavedTransaction({ body: { company: A, active: { $in: [true, false] } }, headers: {} }, res);
    assert.equal(res.code, 201);
    assert.deepEqual(filters, [{ company: A, active: { $in: [true, false] } }]);
  } finally {
    restore();
  }
});

test('GET /transaction: la compañía que deja la ruta entra en el filtro y en la clave de caché', async () => {
  const filters = [];
  const keys = [];
  const Transaction = { find: async (f) => { filters.push(f); return []; } };
  const { ctrl, restore } = loadTransactionController({
    Transaction,
    redis: { get: async (k) => { keys.push(k); return null; }, set: (k) => keys.push(k) },
  });
  try {
    await ctrl.gettingListOfSavedTransaction({ _parsedUrl: { query: 'paymentIntent=pi_1&active=true' }, transactionScopeCompany: A }, mockRes());
    assert.deepEqual(filters[0], { paymentIntent: 'pi_1', active: 'true', company: A });
    assert.deepEqual(keys, [`paymentIntent=pi_1&active=true&__company=${A}`, `paymentIntent=pi_1&active=true&__company=${A}`]);

    await ctrl.gettingListOfSavedTransaction({ _parsedUrl: { query: 'paymentIntent=pi_1' } }, mockRes());
    assert.deepEqual(filters[1], { paymentIntent: 'pi_1' }, 'sin sesión (recibo público) sigue igual');
  } finally {
    restore();
  }
});
