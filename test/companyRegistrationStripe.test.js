'use strict';

/**
 * PATCH /api/company/update-company/register-process/:id (sin sesión): antes
 * guardaba el body entero de cualquier compañía. Ahora solo conecta la cuenta
 * de Stripe, una vez por entorno y en compañías recién creadas.
 * Ver controller/companyRegistrationStripe.js.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createLinkStripeAccountAtRegistration, REGISTRATION_WINDOW_MS } = require('../controller/companyRegistrationStripe');

const NOW = Date.UTC(2026, 10, 3);
const oid = (ms, tail = '0000000000000000') => Math.floor(ms / 1000).toString(16).padStart(8, '0') + tail;
const FRESH = oid(NOW - 60 * 60 * 1000);
const LINKED = oid(NOW - 60 * 60 * 1000, '1111111111111111');
const OLD = oid(NOW - REGISTRATION_WINDOW_MS - 1000, '2222222222222222');

let db;
beforeEach(() => {
  db = {
    [FRESH]: { _id: FRESH, company_name: 'New Co', employees: [{ user: 'owner@new.co' }], stripe_connected_account: { test: null, live: null } },
    [LINKED]: { _id: LINKED, company_name: 'Has Acct', stripe_connected_account: { test: { id: 'acct_ORIGINAL' }, live: null } },
    [OLD]: { _id: OLD, company_name: 'Old Co', stripe_connected_account: { test: null, live: null } },
  };
});

// Lo justo de Mongoose: filtro por _id y por "campo.sub: null", y $set con rutas.
const get = (doc, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
const Company = {
  findOneAndUpdate(filter, update) {
    const doc = db[filter._id];
    const matches = doc && Object.entries(filter).every(([k, v]) => k === '_id' || (get(doc, k) ?? null) === v);
    if (matches) {
      for (const [p, v] of Object.entries(update.$set)) {
        const [a, b] = p.split('.');
        doc[a] = { ...(doc[a] || {}), [b]: v };
      }
    }
    const result = matches ? doc : null;
    return { select: () => ({ lean: async () => result }) };
  },
  exists: async ({ _id }) => (db[_id] ? { _id } : null),
};

const handler = createLinkStripeAccountAtRegistration({
  Company,
  isValidObjectId: (id) => /^[0-9a-f]{24}$/.test(String(id)),
  now: () => NOW,
  logger: { warn() {}, error() {} },
});

async function call(id, body) {
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ params: { id }, body }, res);
  return res;
}

test('alta reciente: conecta la cuenta del entorno y no toca nada más del body', async () => {
  const r = await call(FRESH, {
    stripe_connected_account: { test: { id: 'acct_NEW123', login_links: { url: 'x' } }, live: null },
    employees: [{ user: 'attacker@evil.test', super_user: true }],
    company_name: 'Pwned',
  });
  assert.equal(r.code, 201);
  assert.deepEqual(db[FRESH].stripe_connected_account, { test: { id: 'acct_NEW123', login_links: { url: 'x' } }, live: null });
  assert.equal(db[FRESH].company_name, 'New Co');
  assert.deepEqual(db[FRESH].employees, [{ user: 'owner@new.co' }]);
});

test('cuenta ya conectada en ese entorno: 409 y no la reapunta', async () => {
  const r = await call(LINKED, { stripe_connected_account: { test: { id: 'acct_ATTACKER' } } });
  assert.equal(r.code, 409);
  assert.equal(db[LINKED].stripe_connected_account.test.id, 'acct_ORIGINAL');
});

test('el otro entorno, todavía vacío, sí se puede conectar', async () => {
  const r = await call(LINKED, { stripe_connected_account: { live: 'acct_LIVE1' } });
  assert.equal(r.code, 201);
  assert.equal(db[LINKED].stripe_connected_account.live, 'acct_LIVE1');
  assert.equal(db[LINKED].stripe_connected_account.test.id, 'acct_ORIGINAL');
});

test('compañía fuera del plazo de alta: 403 aunque no tenga cuenta', async () => {
  const r = await call(OLD, { stripe_connected_account: { test: { id: 'acct_X' } } });
  assert.equal(r.code, 403);
  assert.equal(db[OLD].stripe_connected_account.test, null);
});

test('valores inválidos: 400', async () => {
  assert.equal((await call(FRESH, {})).code, 400);
  assert.equal((await call(FRESH, { stripe_connected_account: { test: { id: 'not-an-acct' } } })).code, 400);
  assert.equal((await call(FRESH, { stripe_connected_account: { prod: 'acct_X' } })).code, 400);
  assert.equal((await call(FRESH, { stripe_connected_account: { test: { id: { $ne: null } } } })).code, 400);
  assert.equal((await call(FRESH, { stripe_connected_account: { test: null, live: null } })).code, 400);
  assert.equal((await call('nope', { stripe_connected_account: { test: 'acct_X' } })).code, 400);
});

test('compañía inexistente: 404', async () => {
  const r = await call(oid(NOW, '9999999999999999'), { stripe_connected_account: { test: 'acct_X' } });
  assert.equal(r.code, 404);
});

test('la ruta pública ya no usa updatingCompany', () => {
  const router = require('../routes/company');
  const layer = router.stack.find((l) => l.route?.path === '/update-company/register-process/:id');
  const names = layer.route.stack.map((l) => l.handle.name);
  assert.ok(names.includes('linkStripeAccountAtRegistration'), names.join(','));
  assert.ok(!names.includes('updatingCompany'));
});
