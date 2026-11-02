'use strict';

/**
 * Inyección NoSQL (SI-10, 2026-11-02). Semgrep marcó 27 findOne; 7 alcanzables.
 *
 *   - Middleware global: claves `$...` en body/query, en warn/enforce/off.
 *   - Validación de las dos rutas sin sesión más expuestas:
 *       POST /api/stripe/company-account-stripe/  (cuenta de Stripe ajena)
 *       POST /api/staff/force-logout              (emails de admins)
 *   - Los arreglos puntuales de controlador: alta de compañía, checkUser y
 *     search_subscription, que usaba el body entero como filtro.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const logger = require('../helpers/logger');
const { rejectMongoOperators, findOperatorKey } = require('../middlewares/rejectMongoOperators');

const warnings = [];
logger.warn = (msg, meta) => warnings.push({ msg, meta });

const res = () => {
  const r = { statusCode: 200, body: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.set = () => r;
  return r;
};

const run = (req) => {
  const r = res();
  let nexted = false;
  rejectMongoOperators({ method: 'POST', originalUrl: '/x', headers: {}, query: {}, ...req }, r, () => { nexted = true; });
  return { r, nexted };
};

/* ─── findOperatorKey ──────────────────────────────────────────────────── */

test('findOperatorKey: valores normales no dan nada', () => {
  assert.equal(findOperatorKey({ email: 'a@b.com', n: 1, tags: ['x', { y: 'z' }] }), null);
  assert.equal(findOperatorKey(undefined), null);
  assert.equal(findOperatorKey('$ne'), null, 'un string que empieza por $ es un valor, no una clave');
  assert.equal(findOperatorKey({ price: '$10' }), null);
});

test('findOperatorKey: encuentra el operador y dice dónde', () => {
  assert.equal(findOperatorKey({ email: { $ne: null } }), 'email.$ne');
  assert.equal(findOperatorKey({ a: [{ b: { $regex: '^a' } }] }), 'a[0].b.$regex');
  assert.equal(findOperatorKey({ $where: '1' }), '$where');
});

test('findOperatorKey: anidamiento absurdo cuenta como sospechoso', () => {
  let deep = 'x';
  for (let i = 0; i < 30; i += 1) deep = { k: deep };
  assert.ok(findOperatorKey(deep));
});

/* ─── middleware ───────────────────────────────────────────────────────── */

test('warn (por defecto): deja pasar y registra con el formato que cuenta summarize-warn-logs', () => {
  delete process.env.NOSQL_INPUT_MODE;
  warnings.length = 0;
  const { r, nexted } = run({ body: { company: { $ne: null } } });
  assert.equal(nexted, true);
  assert.equal(r.statusCode, 200);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].msg, /^nosql input: (operator in \S+) allowed \(NOSQL_INPUT_MODE=warn/);
  assert.equal(warnings[0].meta.key, 'company.$ne');
  assert.equal(warnings[0].meta.source, 'body');
});

test('enforce: 400 sin contar qué clave', () => {
  process.env.NOSQL_INPUT_MODE = 'enforce';
  const { r, nexted } = run({ query: { email: { $regex: '^a' } } });
  assert.equal(nexted, false);
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.body, { ok: false, msg: 'Invalid input' });
  delete process.env.NOSQL_INPUT_MODE;
});

test('enforce: una petición normal pasa', () => {
  process.env.NOSQL_INPUT_MODE = 'enforce';
  const { nexted } = run({ body: { email: 'a@b.com' }, query: { page: '1' } });
  assert.equal(nexted, true);
  delete process.env.NOSQL_INPUT_MODE;
});

test('off: no mira nada', () => {
  process.env.NOSQL_INPUT_MODE = 'off';
  warnings.length = 0;
  const { nexted } = run({ body: { $where: '1' } });
  assert.equal(nexted, true);
  assert.equal(warnings.length, 0);
  delete process.env.NOSQL_INPUT_MODE;
});

test('summarize-warn-logs reconoce el modo nuevo', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'summarize-warn-logs.js'), 'utf8');
  assert.match(src, /NOSQL_INPUT_MODE/);
});

test('index.js monta el middleware después de los parsers de body', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const parser = src.lastIndexOf('app.use(express.urlencoded(');
  const mw = src.indexOf('app.use(rejectMongoOperators)');
  assert.notEqual(mw, -1, 'falta app.use(rejectMongoOperators)');
  assert.ok(parser < mw, 'tiene que ir después de express.json/urlencoded');
});

/* ─── validación de las rutas sin sesión ───────────────────────────────── */

/** Corre la cadena de la ruta hasta validateFields (incluido); no toca el controlador. */
const runValidation = async (routerPath, method, routePath, body) => {
  const router = require(routerPath);
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  assert.ok(layer, `no existe ${method.toUpperCase()} ${routePath}`);
  const chain = layer.route.stack.map((l) => l.handle);
  const stop = chain.findIndex((h) => h.name === 'validateFields');
  assert.ok(stop >= 0, `${routePath} no tiene validateFields`);

  const req = { body, query: {}, params: {}, headers: {}, method: method.toUpperCase() };
  const r = res();
  for (let i = 0; i <= stop; i += 1) {
    let called = false;
    await chain[i](req, r, () => { called = true; });
    if (!called) return { status: r.statusCode, body: r.body, passed: false };
  }
  return { status: 200, passed: true };
};

const STRIPE = path.join(__dirname, '..', 'routes', 'stripe');
const STAFF = path.join(__dirname, '..', 'routes', 'staff');

test('company-account-stripe: company como operador → 400', async () => {
  for (const company of [{ $ne: null }, { $regex: '.*' }, ['a'], '', '   ', undefined, 42]) {
    const out = await runValidation(STRIPE, 'post', '/company-account-stripe/', { company });
    assert.equal(out.status, 400, `debería rechazar company=${JSON.stringify(company)}`);
  }
});

test('company-account-stripe: el payload del dashboard pasa', async () => {
  const out = await runValidation(STRIPE, 'post', '/company-account-stripe/', {
    company: 'Acme Events',
    ownerFirstName: 'Ana',
    ownerLastName: 'Pérez',
    ownerEmail: 'ana@acme.com',
  });
  assert.equal(out.passed, true);
});

test('force-logout: email como operador o no-email → 400', async () => {
  for (const email of [{ $ne: null }, { $regex: '^a' }, ['a@b.com'], 'no-es-email', '', undefined]) {
    const out = await runValidation(STAFF, 'post', '/force-logout', { email, password: 'x' });
    assert.equal(out.status, 400, `debería rechazar email=${JSON.stringify(email)}`);
  }
});

test('force-logout: el payload del dashboard pasa, y la validación va antes de tokenIfPresent', async () => {
  const out = await runValidation(STAFF, 'post', '/force-logout', { email: 'admin@acme.com', password: 'secret' });
  assert.equal(out.passed, true);

  const router = require(STAFF);
  const names = router.stack.find((l) => l.route?.path === '/force-logout').route.stack.map((l) => l.handle.name);
  assert.ok(names.indexOf('validateFields') < names.indexOf('tokenIfPresent'));
});

/* ─── arreglos de controlador ──────────────────────────────────────────── */

const Subscription = require('../models/Subscription');
const Company = require('../models/Company');

test('search_subscription: solo filtra por company (string), nunca por el body', async () => {
  const { searchSubscription } = require('../controller/subscription');
  const seen = [];
  const original = Subscription.findOne;
  Subscription.findOne = async (filter) => { seen.push(filter); return { company: 'Acme' }; };
  try {
    const bad = res();
    await searchSubscription({ body: { company: { $ne: null } }, query: {} }, bad);
    assert.equal(bad.statusCode, 400);

    const extra = res();
    await searchSubscription({ body: { company: 'Acme', plan: { $exists: true } }, query: {} }, extra);
    assert.deepEqual(seen.at(-1), { company: 'Acme' }, 'los demás campos del body no entran en el filtro');

    const fromQuery = res();
    await searchSubscription({ body: {}, query: { company: 'Acme' } }, fromQuery);
    assert.equal(fromQuery.statusCode, 200);
  } finally {
    Subscription.findOne = original;
  }
});

test('company-subscription: companyName no-string → 400 sin consultar', async () => {
  const { populateSubscriptionCompany } = require('../controller/subscription');
  const original = Subscription.findOne;
  let called = false;
  Subscription.findOne = async () => { called = true; return null; };
  try {
    const r = res();
    await populateSubscriptionCompany({ body: { companyName: { $ne: null } } }, r);
    assert.equal(r.statusCode, 400);
    assert.equal(called, false);
  } finally {
    Subscription.findOne = original;
  }
});

test('alta de compañía: company_name no-string → 400 sin consultar', async () => {
  const { createCompany } = require('../controller/company');
  const original = Company.findOne;
  let called = false;
  Company.findOne = async () => { called = true; return null; };
  try {
    const r = res();
    await createCompany({ body: { company_name: { $regex: '^A' } } }, r);
    assert.equal(r.statusCode, 400);
    assert.equal(called, false);
  } finally {
    Company.findOne = original;
  }
});

test('checkUser: userInfoEmailCheck no-string → 400 sin consultar', async () => {
  const { checkUser } = require('../controller/auth');
  for (const userInfoEmailCheck of [{ $ne: null }, undefined, '']) {
    const r = res();
    await checkUser({ body: { email: 'a@b.com', userInfoEmailCheck } }, r);
    assert.equal(r.statusCode, 400);
  }
});
