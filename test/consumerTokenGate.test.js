'use strict';

/**
 * Fase C del token de consumidor (2026-10-22): consumerTokenGate.
 *
 *   - Solo actúa en peticiones de la app del consumidor; el dashboard no cambia.
 *   - warn (por defecto): nunca bloquea, registra lo que enforce rechazaría.
 *   - enforce: 401 sin token válido, 403 si no coincide con la petición.
 *   - Rutas de arranque: sin token pasan siempre.
 *   - Todas las rutas que la app llama sin sesión llevan el gate.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
delete process.env.CONSUMER_ORIGINS;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const logged = [];
const loggerFile = path.join(root, 'helpers/logger.js');
require.cache[loggerFile] = {
  id: loggerFile, filename: loggerFile, loaded: true,
  exports: { warn: (msg, meta) => logged.push({ msg, meta }), error() {}, info() {}, log() {} },
};

const { consumerTokenGate } = require('../middlewares/consumerTokenGate');
const { signConsumerToken } = require('../helpers/consumerToken');
const { effectiveChain } = require('./helpers/effectiveChain');

const C = '64b000000000000000000001';
const E = '6ad8dd4b5fcbd00144d97993';
const CO = '64c000000000000000000002';
const APP = 'https://app.devitrak.net';
const token = signConsumerToken({ consumerId: C, eventId: E, companyId: CO, email: 'Ana@X.com' });

function run(gate, { origin = APP, tok, body = {}, params = {} } = {}) {
  const headers = { origin, 'x-consumer-token': tok };
  const req = { headers, header: (n) => headers[n.toLowerCase()], body, params, method: 'POST', url: '/x' };
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  gate(req, res, () => { passed = true; });
  return { req, res, passed };
}

const owned = consumerTokenGate({
  subject: (req) => ({ consumerId: req.params.id, email: req.body.email, eventId: req.body.event_id }),
});

test.beforeEach(() => { logged.length = 0; delete process.env.CONSUMER_TOKEN_MODE; });

test('fuera de la app del consumidor no hace nada (dashboard, sin origen)', () => {
  process.env.CONSUMER_TOKEN_MODE = 'enforce';
  for (const origin of ['https://admin.devitrak.net', null]) {
    const { passed } = run(owned, { origin, params: { id: 'otro' } });
    assert.ok(passed, String(origin));
  }
  assert.equal(logged.length, 0);
});

test('token correcto y petición suya: pasa y deja req.consumerSession', () => {
  process.env.CONSUMER_TOKEN_MODE = 'enforce';
  const { passed, req } = run(owned, { tok: token, params: { id: C }, body: { email: 'ana@x.com', event_id: E } });
  assert.ok(passed);
  assert.equal(req.consumerSession.consumerId, C);
});

test('warn: sin token, token falso o petición ajena pasan, pero quedan en el log', () => {
  for (const opts of [
    {},
    { tok: 'x.y.z' },
    { tok: token, params: { id: '64b0000000000000000000ff' } },
    { tok: token, params: { id: C }, body: { event_id: '6ad8dd4b5fcbd00144d979ff' } },
  ]) {
    const { passed } = run(owned, opts);
    assert.ok(passed);
  }
  assert.equal(logged.length, 4);
  assert.ok(logged.every((l) => l.msg.startsWith('consumer token:')));
  assert.match(logged[2].msg, /consumerId/);
  assert.match(logged[3].msg, /eventId/);
});

test('enforce: 401 sin token válido', () => {
  process.env.CONSUMER_TOKEN_MODE = 'enforce';
  for (const tok of [undefined, 'x.y.z']) {
    const { passed, res } = run(owned, { tok, params: { id: C } });
    assert.equal(passed, false);
    assert.equal(res.code, 401);
  }
});

test('enforce: 403 si la petición es de otro consumidor, email o evento', () => {
  process.env.CONSUMER_TOKEN_MODE = 'enforce';
  for (const opts of [
    { params: { id: '64b0000000000000000000ff' } },
    { params: { id: C }, body: { email: 'otro@x.com' } },
    { params: { id: C }, body: { event_id: '6ad8dd4b5fcbd00144d979ff' } },
  ]) {
    const { passed, res } = run(owned, { tok: token, ...opts });
    assert.equal(passed, false);
    assert.equal(res.code, 403);
  }
});

test('el email se compara sin distinguir mayúsculas', () => {
  process.env.CONSUMER_TOKEN_MODE = 'enforce';
  const { passed } = run(owned, { tok: token, params: { id: C }, body: { email: 'ANA@x.COM' } });
  assert.ok(passed);
});

test('arranque: sin token pasa siempre y no se registra; con token se comprueba', () => {
  process.env.CONSUMER_TOKEN_MODE = 'enforce';
  const boot = consumerTokenGate({ bootstrap: true, subject: (req) => ({ eventId: req.body._id }) });
  assert.ok(run(boot, { body: { _id: E } }).passed);
  assert.equal(logged.length, 0);
  assert.equal(run(boot, { tok: token, body: { _id: '6ad8dd4b5fcbd00144d979ff' } }).res.code, 403);
});

test('off: no comprueba nada', () => {
  process.env.CONSUMER_TOKEN_MODE = 'off';
  assert.ok(run(owned, { params: { id: 'otro' } }).passed);
});

// ─── cobertura: toda ruta de la app lleva el gate ───────────────────────────

const GATED = [
  ['routes/auth', 'PATCH', '/:id'],
  ['routes/auth', 'GET', '/:id'],
  ['routes/auth', 'POST', '/user-query'],
  ['routes/auth', 'POST', '/new'],
  ['mysql/routes/consumers', 'POST', '/new_consumer'],
  ['routes/stripe', 'GET', '/payment_intents/:id'],
  ['routes/stripe', 'POST', '/create-payment-intent'],
  ['routes/stripe', 'POST', '/customer'],
  ['routes/transaction', 'POST', '/transaction'],
  ['routes/transaction', 'POST', '/save-transaction'],
  ['routes/company', 'POST', '/event-consumer-signatures'],
  ['routes/post', 'POST', '/posts'],
  ['routes/nodeMailer', 'POST', '/confirmation-account'],
  ['routes/receivers', 'POST', '/receiver-assigned-list'],
  ['routes/event', 'POST', '/event-list'],
  ['routes/document', 'POST', '/download/documentUrl'],
];

for (const [file, method, routePath] of GATED) {
  test(`gate montado: ${method} ${file.split('/').pop()}${routePath}`, () => {
    const chain = effectiveChain(require(path.join(root, file)), method, routePath);
    assert.ok(chain, 'la ruta tiene que existir');
    assert.ok(chain.some((h) => h.name === 'consumerTokenGate'), chain.map((h) => h.name).join(' > '));
  });
}

test('gate montado: /api/cloudinary', () => {
  const line = fs.readFileSync(path.join(root, 'index.js'), 'utf8')
    .split('\n').find((l) => l.includes('app.use("/api/cloudinary"'));
  assert.match(line, /consumerTokenGate\(\)/);
});
