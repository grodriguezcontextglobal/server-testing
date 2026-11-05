'use strict';

/**
 * Stripe A8b (FedRAMP AC-3): el recurso de Stripe sobre el que actúa una ruta
 * de suscripción o facturación tiene que ser de la compañía del contexto.
 * Ver middlewares/requireStripeOwnership.js.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequireStripeOwnership } = require('../middlewares/requireStripeOwnership');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const SC_A = 'cccccccccccccccccccccccc';
const SC_B = 'dddddddddddddddddddddddd';

// `staff` es empleado de las dos (por userId en A, por email en B), así cada
// test mira el recurso y no la pertenencia. `outsider` no es de ninguna y
// `former` estuvo en A y ya no está activo.
const companies = {
  [A]: {
    _id: A, company_name: 'Acme', stripe_customer_id: 'cus_A1', stripe_connected_account: { test: 'acct_A' },
    employees: [{ userId: 'staff', user: 'staff@acme.test' }, { user: 'former@acme.test', active: false }],
  },
  [B]: {
    _id: B, company_name: 'Beta', stripe_customer_id: 'unknown', stripe_connected_account: { test: null },
    employees: [{ user: 'staff@acme.test', active: true }],
  },
};
const subscriptionRecords = { rec_A: { company: 'acme ' }, rec_B: { company: 'Beta' } };
const stripeCompanies = [
  { _id: SC_A, companyName: 'ACME ', stripeID: 'cus_A2' },
  { _id: SC_B, companyName: 'Beta', stripeID: 'cus_B1' },
];
const subscriptions = { sub_A: { customer: 'cus_A2' }, sub_B: { customer: 'cus_B1' }, sub_Aobj: { customer: { id: 'cus_A1' } } };
const setupIntents = { seti_A: { customer: null, payment_method: 'pm_A' }, seti_B: { customer: 'cus_B1' } };
const paymentMethods = { pm_A: { customer: 'cus_A1' } };
const paymentIntents = { pi_meta: { metadata: { company_id: A } }, pi_cus: { customer: 'cus_A2', metadata: {} }, pi_B: { customer: 'cus_B1', metadata: {} } };

let warnings, errors, admins, stripeDown;
const missing = () => Object.assign(new Error('No such'), { code: 'resource_missing' });
const lookup = (table) => async (id) => {
  if (stripeDown) throw new Error('Stripe unavailable');
  if (!(id in table)) throw missing();
  return table[id];
};

const guard = createRequireStripeOwnership({
  findAdmin: async (uid) => admins[uid] ?? null,
  resolveCompany: (req) => req.headers['x-company-id'] ?? null,
  findCompany: async (id) => companies[id] ?? null,
  findStripeCompaniesByName: async (name) =>
    stripeCompanies.filter((s) => s.companyName.trim().toLowerCase() === String(name).trim().toLowerCase()),
  findStripeCompany: async (id) => stripeCompanies.find((s) => s._id === id) ?? null,
  findTransaction: async (id) => ({ tx_A: { company: { _id: A } }, tx_B: { company: B } })[id] ?? null,
  findStripeTransaction: async (id) => ({ stx_A: { company: A }, stx_B: { company: B } })[id] ?? null,
  findSubscriptionRecord: async (id) => subscriptionRecords[id] ?? null,
  stripeApi: {
    retrieveSubscription: lookup(subscriptions),
    retrieveSetupIntent: lookup(setupIntents),
    retrievePaymentMethod: lookup(paymentMethods),
    retrievePaymentIntent: lookup(paymentIntents),
  },
  connectedAccountOf: (company) => company.stripe_connected_account?.test ?? null,
  logger: { warn: (msg, meta) => warnings.push({ msg, meta }), error: (msg) => errors.push(msg) },
});

beforeEach(() => {
  warnings = [];
  errors = [];
  admins = {
    root: { super_user: true },
    staff: { super_user: false, email: 'staff@acme.test' },
    outsider: { super_user: false, email: 'out@else.test' },
    former: { super_user: false, email: 'former@acme.test' },
  };
  stripeDown = false;
  process.env.STRIPE_OWNERSHIP_MODE = 'enforce';
});
afterEach(() => { delete process.env.STRIPE_OWNERSHIP_MODE; });

async function run(kind, id, { company = A, uid = 'staff', opts, body } = {}) {
  const req = { uid, body, headers: company ? { 'x-company-id': company } : {}, originalUrl: '/api/stripe/x', method: 'POST' };
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  await guard(kind, () => id, opts)(req, res, () => { passed = true; });
  return { passed, code: res.code, body: res.body, req };
}

// ═══ dueño ══════════════════════════════════════════════════════════════════

test('customer: vale el stripe_customer_id de la compañía y el stripeID de su StripeCompany (nombre sin mayúsculas ni espacios)', async () => {
  assert.equal((await run('customer', 'cus_A1')).passed, true);
  assert.equal((await run('customer', 'cus_A2')).passed, true);
  const other = await run('customer', 'cus_B1');
  assert.equal(other.passed, false);
  assert.equal(other.code, 404);
});

test('subscription: por el customer de la suscripción (string u objeto expandido)', async () => {
  assert.equal((await run('subscription', 'sub_A')).passed, true);
  assert.equal((await run('subscription', 'sub_Aobj')).passed, true);
  assert.equal((await run('subscription', 'sub_B')).code, 404);
});

test('subscription: la compañía B (sin cus_ en Company) se reconoce por su StripeCompany', async () => {
  assert.equal((await run('subscription', 'sub_B', { company: B })).passed, true);
  assert.equal((await run('subscription', 'sub_A', { company: B })).code, 404);
});

test('setupIntent: por su customer o, si no tiene, por el de su método de pago', async () => {
  assert.equal((await run('setupIntent', 'seti_A')).passed, true);
  assert.equal((await run('setupIntent', 'seti_B')).code, 404);
});

test('paymentIntent: por metadata.company_id o por su customer', async () => {
  assert.equal((await run('paymentIntent', 'pi_meta')).passed, true);
  assert.equal((await run('paymentIntent', 'pi_cus')).passed, true);
  assert.equal((await run('paymentIntent', 'pi_B')).code, 404);
});

test('connectedAccount: el acct_ de la compañía', async () => {
  assert.equal((await run('connectedAccount', 'acct_A')).passed, true);
  assert.equal((await run('connectedAccount', 'acct_X')).code, 404);
  assert.equal((await run('connectedAccount', 'acct_A', { company: B })).code, 404);
});

test('stripeCompany: el registro de la compañía, por stripeID o por nombre', async () => {
  assert.equal((await run('stripeCompany', SC_A)).passed, true);
  assert.equal((await run('stripeCompany', SC_B)).code, 404);
  assert.equal((await run('stripeCompany', 'eeeeeeeeeeeeeeeeeeeeeeee')).code, 404);
});

// ═══ transacciones ══════════════════════════════════════════════════════════

test('company: el body.company tiene que ser la compañía del contexto', async () => {
  assert.equal((await run('company', A)).passed, true);
  assert.equal((await run('company', B)).code, 404);
  assert.equal((await run('company', undefined)).code, 400, 'guardar sin compañía no vale');
});

test('transaction y stripeTransaction: la compañía del documento que se borra', async () => {
  assert.equal((await run('transaction', 'tx_A')).passed, true);
  assert.equal((await run('transaction', 'tx_B')).code, 404);
  assert.equal((await run('transaction', 'tx_none')).code, 404);
  assert.equal((await run('stripeTransaction', 'stx_A')).passed, true);
  assert.equal((await run('stripeTransaction', 'stx_B')).code, 404);
});

test('listado sin company: enforce la pone con la del contexto; con otra, 404', async () => {
  const opts = { injectBodyCompany: true };
  const r = await run('company', undefined, { opts, body: { eventSelected: 'X' } });
  assert.equal(r.passed, true);
  assert.deepEqual(r.req.body, { eventSelected: 'X', company: A });
  assert.equal((await run('company', B, { opts, body: { company: B } })).code, 404);
});

test('listado sin company en warn: deja pasar sin tocar el filtro y lo registra', async () => {
  process.env.STRIPE_OWNERSHIP_MODE = 'warn';
  const r = await run('company', undefined, { opts: { injectBodyCompany: true }, body: {} });
  assert.equal(r.passed, true);
  assert.deepEqual(r.req.body, {});
  assert.equal(warnings[0].meta.reason, 'unscoped_list');
});

test('búsqueda de pagos: enforce deja la compañía para filtrar; plataforma busca en todas', async () => {
  const r = await run('paymentIntentSearch', undefined);
  assert.equal(r.passed, true);
  assert.equal(r.req.stripeSearchCompany, A);
  const root = await run('paymentIntentSearch', undefined, { uid: 'root', company: null });
  assert.equal(root.req.stripeSearchCompany, undefined);
  assert.equal((await run('paymentIntentSearch', undefined, { company: null })).code, 400);
});

test('subscriptionRecord: el Subscription de Mongo por el nombre de su compañía (sin mayúsculas ni espacios)', async () => {
  assert.equal((await run('subscriptionRecord', 'rec_A')).passed, true);
  assert.equal((await run('subscriptionRecord', 'rec_B')).code, 404);
  assert.equal((await run('subscriptionRecord', 'rec_nope')).code, 404);
});

test('companyName: el nombre que trae la petición tiene que ser el de la compañía del contexto', async () => {
  assert.equal((await run('companyName', ' ACME')).passed, true);
  assert.equal((await run('companyName', 'Beta')).code, 404);
  assert.equal((await run('companyName', 'Beta', { company: B })).passed, true);
});

// ═══ pertenencia a la compañía del contexto ═════════════════════════════════

test('x-company-id de una compañía a la que no pertenece: 403 aunque el recurso sea de esa compañía', async () => {
  // Antes pasaba: el recurso era de B y el contexto decía B.
  const r = await run('subscription', 'sub_B', { uid: 'outsider', company: B });
  assert.equal(r.passed, false);
  assert.equal(r.code, 403);
  assert.equal(warnings.at(-1).meta.reason, 'not_a_member');
});

test('empleado inactivo: 403', async () => {
  assert.equal((await run('customer', 'cus_A1', { uid: 'former' })).code, 403);
});

test('empleado por userId o por email: pasa', async () => {
  assert.equal((await run('customer', 'cus_A1')).passed, true); // A: por userId
  assert.equal((await run('customer', 'cus_B1', { company: B })).passed, true); // B: por email
});

test('no miembro en warn: deja pasar y lo registra como not_a_member', async () => {
  process.env.STRIPE_OWNERSHIP_MODE = 'warn';
  const r = await run('subscription', 'sub_B', { uid: 'outsider', company: B });
  assert.equal(r.passed, true);
  assert.match(warnings[0].msg, /^stripe ownership: not_a_member \(STRIPE_OWNERSHIP_MODE=warn\)/);
});

// ═══ casos generales ════════════════════════════════════════════════════════

test('recurso inexistente en Stripe: 404, igual que uno ajeno', async () => {
  const r = await run('subscription', 'sub_nope');
  assert.equal(r.code, 404);
  assert.equal(r.body.msg, 'Not found.');
});

test('super_user de plataforma: pasa con cualquier recurso y sin compañía', async () => {
  assert.equal((await run('subscription', 'sub_B', { uid: 'root' })).passed, true);
  assert.equal((await run('customer', 'cus_B1', { uid: 'root', company: null })).passed, true);
});

test('sin compañía en el contexto: 400', async () => {
  assert.equal((await run('subscription', 'sub_A', { company: null })).code, 400);
});

test('sin id: 400', async () => {
  assert.equal((await run('customer', undefined)).code, 400);
});

test('Stripe caído: enforce responde 500; warn deja pasar', async () => {
  stripeDown = true;
  assert.equal((await run('subscription', 'sub_A')).code, 500);
  process.env.STRIPE_OWNERSHIP_MODE = 'warn';
  assert.equal((await run('subscription', 'sub_A')).passed, true);
});

test('warn (por defecto): deja pasar el recurso ajeno y lo registra con su motivo', async () => {
  delete process.env.STRIPE_OWNERSHIP_MODE;
  const r = await run('subscription', 'sub_B');
  assert.equal(r.passed, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].msg, /^stripe ownership: subscription_not_owned \(STRIPE_OWNERSHIP_MODE=warn\)/);
});

test('off: no mira nada', async () => {
  process.env.STRIPE_OWNERSHIP_MODE = 'off';
  assert.equal((await run('subscription', 'sub_B', { company: null })).passed, true);
});

// ═══ rutas ══════════════════════════════════════════════════════════════════

test('las rutas de suscripción y facturación llevan la guarda de dueño detrás de la sesión', () => {
  const router = require('../routes/stripe');
  const GUARDED = [
    'GET /subscriptions/:id', 'DELETE /subscriptions/:id', 'POST /cancel/subscriptions/:id',
    'POST /payment-method/subscriptions/:id', 'GET /invoices', 'POST /invoices',
    'POST /create-subscriptions', 'POST /create-subscriptions_no_trial', 'POST /payment_methods/:id/attach',
    'POST /payment_intents/:id/update-payment-method', 'POST /setup-search', 'PATCH /updating-subscription/:id',
    'POST /account_sessions', 'POST /company-account-stripe/update',
    'GET /payment-intents/search', 'GET /stripe-transactions-saved-list', 'POST /stripe-transactions-saved-list',
    'POST /stripe-transaction-no-regular-user', 'DELETE /remove-duplicate/:id', 'POST /save-transaction',
    'POST /save-transaction-admin-dashboard', 'POST /save-transaction-template-no-regular-user',
    'GET /transaction', 'DELETE /removing/:id',
  ];
  for (const key of GUARDED) {
    const [method, p] = key.split(' ');
    const layer = router.stack.find((l) => l.route?.path === p && l.route.methods[method.toLowerCase()]);
    assert.ok(layer, key);
    const names = layer.route.stack.map((l) => l.handle.name);
    const at = names.indexOf('requireStripeOwnership');
    assert.ok(at > names.indexOf('checkTokenVersion') && names.indexOf('checkTokenVersion') >= 0, key);
  }
});

test('/api/subscription: todas las rutas llevan la guarda de dueño detrás de la sesión', () => {
  const router = require('../routes/subscription');
  const routes = router.stack.filter((l) => l.route);
  assert.equal(routes.length, 8);
  for (const layer of routes) {
    const key = `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`;
    const names = layer.route.stack.map((l) => l.handle.name);
    assert.ok(names.indexOf('checkTokenVersion') >= 0, key);
    assert.ok(names.indexOf('requireStripeOwnership') > names.indexOf('checkTokenVersion'), key);
  }
  // update-subscription: además, el body no puede mover la suscripción de compañía.
  const update = routes.find((l) => l.route.path === '/update-subscription/:id');
  assert.ok(update.route.stack.some((l) => l.handle.name === 'keepsSubscriptionCompany'));
});

// ═══ updating-subscription: solo subscriptionHistory ════════════════════════

test('updateSubcriptionInCompanyAccount escribe solo subscriptionHistory', async () => {
  const root = path.resolve(__dirname, '..');
  const scPath = path.join(root, 'models/StripeCompany.js');
  const ctrlPath = path.join(root, 'controller/stripe.js');
  const clientPath = path.join(root, 'helpers/stripeClient.js');
  const saved = { sc: require.cache[scPath], ctrl: require.cache[ctrlPath], client: require.cache[clientPath] };
  const writes = [];
  require.cache[scPath] = { id: scPath, filename: scPath, loaded: true, exports: {
    findByIdAndUpdate: async (id, update) => { writes.push({ id, update }); return { id }; },
  } };
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: {
    stripe: {}, runStripeMutation: (t) => t(), createRunStripeMutation: () => (t) => t(), isStripeInfraFailure: () => false,
  } };
  delete require.cache[ctrlPath];
  try {
    const { updateSubcriptionInCompanyAccount } = require(ctrlPath);
    const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await updateSubcriptionInCompanyAccount(
      { params: { id: SC_A }, body: { subscriptionHistory: [{ a: 1 }], stripeID: 'cus_B1', companyName: 'Beta' } },
      res
    );
    assert.equal(res.code, 201);
    assert.deepEqual(writes, [{ id: SC_A, update: { $set: { subscriptionHistory: [{ a: 1 }] } } }]);
    assert.deepEqual(res.body.ignored_fields, ['stripeID', 'companyName']);

    const bad = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await updateSubcriptionInCompanyAccount({ params: { id: SC_A }, body: { stripeID: 'cus_B1' } }, bad);
    assert.equal(bad.code, 400);
    assert.equal(writes.length, 1);
  } finally {
    for (const [p, k] of [[scPath, 'sc'], [ctrlPath, 'ctrl'], [clientPath, 'client']]) {
      if (saved[k]) require.cache[p] = saved[k];
      else delete require.cache[p];
    }
  }
});
