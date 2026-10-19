'use strict';

/**
 * FedRAMP S0.1 / S1.11 (2026-10-19).
 *
 * - Cinco consultas armaban el SQL con las claves del body como nombres de
 *   columna, sin sesión: consulting-lease, consulting-consumer-lease,
 *   consulting-consumer, current-inventory y consulting-stripe. Ahora solo
 *   columnas reales (400 si no) y sesión obligatoria.
 * - El resto de /db_lease/*, consumers_information (devolvía todo consumer_info)
 *   y /admin/users iban sin sesión.
 * - /admin/invalidate-all-sessions cerraba la sesión de todo el staff con solo
 *   llamarla: ahora super_user de plataforma.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const executed = [];
const fakeConnection = {
  execute: async (sql, values) => { executed.push({ sql, values }); return [[]]; },
  query: async (sql, values) => { executed.push({ sql, values }); return [[]]; },
};
stub('mysql/database/config.js', () => fakeConnection);
stub('helpers/logger.js', { error: () => {}, warn: () => {}, info: () => {} });

const { validateJWT } = require('../middlewares/validate-jwt');
const { checkTokenVersion } = require('../middlewares/checkValidateToken');
const { requireSuperUser } = require('../middlewares/requireSuperUser');
const { consultingLease, consultingConsumerLease } = require('../mysql/controllers/lease');
const { consultingConsumerInfo } = require('../mysql/controllers/consumer');
const { consultingStripeCustomer } = require('../mysql/controllers/stripe');

const res = () => {
  const r = {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const call = async (fn, body) => { const r = res(); await fn({ body }, r); return r; };

const handlersOf = (routerPath, method, routePath) => {
  const router = require(routerPath);
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath} debe existir`);
  return layer.route.stack.map((l) => l.handle);
};

// ── rutas ───────────────────────────────────────────────────────────────────

const SESSION_ROUTES = [
  ['../mysql/routes/lease', 'post', '/consulting-lease'],
  ['../mysql/routes/lease', 'post', '/consulting-consumer-lease'],
  ['../mysql/routes/lease', 'post', '/new-lease'],
  ['../mysql/routes/lease', 'post', '/new-consumer-lease'],
  ['../mysql/routes/lease', 'post', '/update-lease-info'],
  ['../mysql/routes/lease', 'post', '/update-consumer-lease-info'],
  ['../mysql/routes/lease', 'post', '/delete-lease-info'],
  ['../mysql/routes/lease', 'post', '/delete-consumer-lease-info'],
  ['../mysql/routes/consumers', 'post', '/consulting-consumer'],
  ['../mysql/routes/consumers', 'post', '/consumers_information'],
  ['../mysql/routes/stripe', 'post', '/consulting-stripe'],
  ['../mysql/routes/item', 'post', '/current-inventory'],
  ['../routes/admin', 'post', '/users'],
  ['../routes/admin', 'post', '/invalidate-all-sessions'],
];

for (const [file, method, routePath] of SESSION_ROUTES) {
  test(`${file}: ${method.toUpperCase()} ${routePath} exige sesión (validateJWT + checkTokenVersion)`, () => {
    const handlers = handlersOf(file, method, routePath);
    assert.ok(handlers.includes(validateJWT), 'validateJWT');
    assert.ok(handlers.includes(checkTokenVersion), 'checkTokenVersion');
  });
}

test('invalidate-all-sessions: además, solo super_user de plataforma', () => {
  assert.ok(handlersOf('../routes/admin', 'post', '/invalidate-all-sessions').includes(requireSuperUser));
});

test('transaction-audit-log: create-audit retirada (nadie puede escribir en el log desde fuera)', () => {
  const router = require('../routes/transactionAuditLog');
  const posts = router.stack.filter((l) => l.route?.methods.post).map((l) => l.route.path);
  assert.deepEqual(posts, []);
});

test('transaction-audit-log: audit-log solo con sesión de super_user de plataforma', () => {
  const handlers = handlersOf('../routes/transactionAuditLog', 'get', '/audit-log');
  for (const mw of [validateJWT, checkTokenVersion, requireSuperUser]) assert.ok(handlers.includes(mw), mw.name);
});

test('invalidate-all-sessions ya no vuelca la petición entera en los logs', () => {
  const src = require('node:fs').readFileSync(path.join(root, 'controller/admin.js'), 'utf8');
  const fn = src.slice(src.indexOf('const invalidateAllSessions'), src.indexOf('module.exports'));
  assert.equal(/console\.log\(\s*req\s*\)/.test(fn), false);
});

// ── inyección: las claves del body ya no llegan al SQL ──────────────────────

const INJECTION = { 'device_id`=1 OR 1=1 -- ': 1 };

for (const [name, fn] of [
  ['consulting-lease', consultingLease],
  ['consulting-consumer-lease', consultingConsumerLease],
  ['consulting-consumer', consultingConsumerInfo],
  ['consulting-stripe', consultingStripeCustomer],
]) {
  test(`${name}: una clave que no es columna → 400 y no se ejecuta SQL`, async () => {
    executed.length = 0;
    const r = await call(fn, INJECTION);
    assert.equal(r.code, 400);
    assert.equal(executed.length, 0);
  });
}

test('consultas sin filtros → 400 (antes, error de SQL)', async () => {
  for (const fn of [consultingLease, consultingConsumerLease, consultingConsumerInfo, consultingStripeCustomer]) {
    executed.length = 0;
    assert.equal((await call(fn, {})).code, 400);
    assert.equal(executed.length, 0);
  }
});

// ── lo que manda hoy el dashboard sigue pasando ─────────────────────────────

test('dashboard: los cuerpos reales pasan, con columnas entre comillas invertidas y valores parametrizados', async () => {
  const cases = [
    [consultingLease, { device_id: 200572 }, 'lease_info', [200572]],
    [consultingLease, { staff_member_id: 144, company_id: 147, subscription_current_in_use: 1 }, 'lease_info', [144, 147, 1]],
    [consultingConsumerLease, { consumer_member_id: 9, company_id: 147, device_id: 3, subscription_current_in_use: 1 }, 'lease_customer_info', [9, 147, 3, 1]],
    [consultingConsumerLease, { consumer_member_id: 9 }, 'lease_customer_info', [9]],
    [consultingConsumerInfo, { email: 'a@b.com' }, 'consumer_info', ['a@b.com']],
    [consultingStripeCustomer, { company_id: 147 }, 'stripe_info', [147]],
  ];
  for (const [fn, body, table, values] of cases) {
    executed.length = 0;
    const r = await call(fn, body);
    assert.equal(r.code, 200, JSON.stringify(body));
    assert.match(executed[0].sql, new RegExp(`FROM ${table} WHERE`));
    for (const k of Object.keys(body)) assert.ok(executed[0].sql.includes(`\`${k}\`=?`) || executed[0].sql.includes(`\`${k}\` = ?`), k);
    assert.deepEqual(executed[0].values, values);
  }
});
