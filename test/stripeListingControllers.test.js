'use strict';

/**
 * Listados y transacciones de /api/stripe (FedRAMP A8, 2026-10-27): lo que
 * cambia en los controladores. El dueño lo comprueba la ruta
 * (test/stripeOwnership.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';

/** Carga un controlador con módulos sustituidos y devuelve cómo deshacerlo. */
function loadWith(controllerRel, stubs) {
  const p = (rel) => path.join(root, rel);
  const keys = [...Object.keys(stubs), controllerRel];
  const saved = Object.fromEntries(keys.map((k) => [k, require.cache[p(k)]]));
  for (const [k, exports] of Object.entries(stubs)) {
    require.cache[p(k)] = { id: p(k), filename: p(k), loaded: true, exports };
  }
  delete require.cache[p(controllerRel)];
  const ctrl = require(p(controllerRel));
  const restore = () => {
    for (const k of keys) {
      if (saved[k]) require.cache[p(k)] = saved[k];
      else delete require.cache[p(k)];
    }
  };
  return { ctrl, restore };
}

const stripeClient = (stripe) => ({
  stripe,
  runStripeMutation: (t) => t(),
  createRunStripeMutation: () => (t) => t(),
  isStripeInfraFailure: () => false,
});
const mockRes = () => ({ status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test('searchStripeTransaction filtra por metadata.company_id cuando la ruta lo pide, y solo con un ObjectId', async () => {
  const queries = [];
  const { ctrl, restore } = loadWith('controller/stripe.js', {
    'helpers/stripeClient.js': stripeClient({
      paymentIntents: { search: async ({ query }) => { queries.push(query); return { data: [] }; } },
    }),
  });
  try {
    await ctrl.searchStripeTransaction({ stripeSearchCompany: A }, mockRes());
    await ctrl.searchStripeTransaction({}, mockRes());
    await ctrl.searchStripeTransaction({ stripeSearchCompany: 'x OR status:succeeded' }, mockRes());
    assert.deepEqual(queries, [
      `status:'requires_capture' AND metadata['company_id']:'${A}'`,
      "status:'requires_capture'",
      "status:'requires_capture'",
    ]);
  } finally {
    restore();
  }
});

test('getListOfAllSavedStripeTransaction neutraliza operadores del filtro del cliente', async () => {
  const filters = [];
  const { ctrl, restore } = loadWith('controller/stripe.js', {
    'helpers/stripeClient.js': stripeClient({}),
    'models/StripeTransaction.js': { find: (f) => { filters.push(f); return { populate: async () => [] }; } },
  });
  try {
    const res = mockRes();
    await ctrl.getListOfAllSavedStripeTransaction({ body: { company: A, paymentIntent: { $ne: null } } }, res);
    assert.equal(res.code, 201);
    assert.equal(filters[0].company, A);
    assert.deepEqual(filters[0].paymentIntent, { $eq: { $ne: null } });
  } finally {
    restore();
  }
});

test('saveTransactionTemplateForNoRegularUser guarda (antes, ReferenceError y 500 siempre)', async () => {
  function Transaction(doc) {
    Object.assign(this, doc);
    this.save = async () => ({ ...doc, _id: 'new' });
  }
  const { ctrl, restore } = loadWith('controller/transaction.js', {
    'models/Transaction.js': Transaction,
    'database/cacheMemoryConfig.js': { clientRedis: async () => ({ del: () => {} }) },
    'helpers/logger.js': { error: () => {}, warn: () => {}, info: () => {} },
  });
  try {
    const res = mockRes();
    await ctrl.saveTransactionTemplateForNoRegularUser({ body: { company: A, event_id: 'e', consumerInfo: { id: 'c' } } }, res);
    assert.equal(res.code, 201);
    assert.equal(res.body.Transaction._id, 'new');
  } finally {
    restore();
  }
});
