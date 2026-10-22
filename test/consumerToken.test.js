'use strict';

/**
 * Token de consumidor, fase A (2026-10-21).
 *
 *   - Lleva consumidor, evento y compañía firmados, con clave propia.
 *   - No vale como sesión de staff (validateJWT), ni un token de staff vale
 *     como token de consumidor.
 *   - Caduca 7 días después del fin del evento, entre 1 y 30 días.
 *   - Enlace por correo: respuesta genérica (no revela quién existe), un solo
 *     uso, y el canje devuelve el consumidor y su token.
 */

process.env.SECRET_JWT_SEED = 'test-seed-consumer';
delete process.env.CONSUMER_JWT_SECRET;

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub('helpers/logger.js', { warn() {}, error() {}, info() {}, log() {} });
stub('helpers/queue.js', { enqueue: async () => ({}) });

const { signConsumerToken, readConsumerToken, ttlFor, MAX_TTL_S } = require('../helpers/consumerToken');
const { validateJWT } = require('../middlewares/validate-jwt');
const { readEmailLinkToken, signEmailLinkToken } = require('../helpers/emailLinkToken');
const {
  requestConsumerLoginLink,
  redeemConsumerSession,
  CONSUMER_LOGIN_PURPOSE,
} = require('../controller/consumerSession');

const C = '64b000000000000000000001';
const E = '6ad8dd4b5fcbd00144d97993';
const CO = '64c000000000000000000002';

function res() {
  return { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const chain = (value) => ({ select() { return this; }, lean: async () => value });

// ─── el token ────────────────────────────────────────────────────────────────

test('lleva consumidor, evento y compañía, y se lee de vuelta', () => {
  const t = signConsumerToken({ consumerId: C, eventId: E, companyId: CO, eventEnd: new Date(Date.now() + 86400e3) });
  const r = readConsumerToken(t);
  assert.equal(r.consumerId, C);
  assert.equal(r.eventId, E);
  assert.equal(r.companyId, CO);
});

test('un token de consumidor NO pasa validateJWT (no es sesión de staff)', () => {
  const t = signConsumerToken({ consumerId: C, eventId: E, companyId: CO });
  const req = { header: (n) => (n === 'x-token' ? t : undefined) };
  const r = res();
  let next = false;
  validateJWT(req, r, () => { next = true; });
  assert.equal(next, false);
  assert.equal(r.code, 401);
});

test('un token de staff NO vale como token de consumidor', () => {
  const staff = jwt.sign({ uid: C, sub: C, typ: 'consumer', evt: E }, process.env.SECRET_JWT_SEED, { expiresIn: '1h' });
  assert.equal(readConsumerToken(staff), null);
});

test('caducidad: 7 días tras el fin del evento, entre 1 y 30 días', () => {
  const day = 86400;
  assert.ok(Math.abs(ttlFor(new Date(Date.now() + 3 * day * 1000)) - 10 * day) <= 2);
  assert.equal(ttlFor(new Date(Date.now() - 60 * day * 1000)), day);
  assert.equal(ttlFor(new Date(Date.now() + 365 * day * 1000)), MAX_TTL_S);
  assert.equal(ttlFor(undefined), MAX_TTL_S);
});

// ─── POST /consumer-login-link ──────────────────────────────────────────────

const eventModel = (event) => ({ findById: () => chain(event) });
const userModel = (user) => ({ findOne: () => chain(user), findById: () => chain(user) });

test('login-link: misma respuesta exista o no el email, y solo encola si existe', async () => {
  const sent = [];
  const deps = (user) => ({
    EventModel: eventModel({ company_id: CO, eventInfoDetail: { eventName: 'Fair' } }),
    UserModel: userModel(user),
    enqueueFn: async (type, msg) => sent.push({ type, msg }),
    branding: async () => undefined, // marca por defecto de Devitrak, sin BD
  });
  const known = res();
  await requestConsumerLoginLink({ body: { email: 'Ana@X.com', event_id: E } }, known,
    deps({ _id: C, name: 'Ana', lastName: 'B', email: 'ana@x.com' }));
  const unknown = res();
  await requestConsumerLoginLink({ body: { email: 'nadie@x.com', event_id: E } }, unknown, deps(null));

  assert.equal(known.code, 200);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'send-email');
  assert.equal(sent[0].msg.to, 'ana@x.com');

  const token = decodeURIComponent(sent[0].msg.html.match(/authentication\?token=([^"&<\s]+)/)[1]);
  const claims = readEmailLinkToken(CONSUMER_LOGIN_PURPOSE, token);
  assert.equal(claims.consumer_id, C);
  assert.equal(claims.event_id, E);
  assert.equal(claims.company_id, CO);
});

test('login-link: evento inexistente → respuesta genérica, sin correo', async () => {
  let sent = 0;
  const r = res();
  await requestConsumerLoginLink({ body: { email: 'a@x.com', event_id: E } }, r, {
    EventModel: eventModel(null), UserModel: userModel({ _id: C }), enqueueFn: async () => { sent++; }, branding: async () => undefined,
  });
  assert.equal(r.code, 200);
  assert.equal(sent, 0);
});

test('login-link: sin email o con un event_id inválido → 400', async () => {
  for (const body of [{}, { email: 'a@x.com' }, { email: 'a@x.com', event_id: 'nope' }]) {
    const r = res();
    await requestConsumerLoginLink({ body }, r, {});
    assert.equal(r.code, 400);
  }
});

// ─── POST /consumer-session ─────────────────────────────────────────────────

const linkFor = (claims) => signEmailLinkToken(CONSUMER_LOGIN_PURPOSE, claims);
const reqWith = (token) => ({ header: (n) => (n === 'x-link-token' ? token : undefined), body: {} });

test('session: canjea el enlace y devuelve el consumidor y su token de ese evento', async () => {
  const r = res();
  await redeemConsumerSession(reqWith(linkFor({ consumer_id: C, event_id: E, company_id: CO })), r, {
    UserModel: userModel({ _id: C, name: 'Ana', lastName: 'B', email: 'ana@x.com', phoneNumber: '1' }),
    issueToken: async (id, evt) => signConsumerToken({ consumerId: id, eventId: evt, companyId: CO }),
    consume: async () => 'consumed',
  });
  assert.equal(r.code, 200);
  assert.equal(r.body.consumer.id, C);
  assert.equal(r.body.event_id, E);
  const t = readConsumerToken(r.body.token);
  assert.equal(t.consumerId, C);
  assert.equal(t.eventId, E);
});

test('session: sin enlace o con uno falso → 401', async () => {
  for (const token of [undefined, 'x.y.z', signEmailLinkToken('contract_signing', { consumer_id: C })]) {
    const r = res();
    await redeemConsumerSession(reqWith(token), r, {});
    assert.equal(r.code, 401);
  }
});

test('session: un enlace ya usado → 410', async () => {
  const r = res();
  await redeemConsumerSession(reqWith(linkFor({ consumer_id: C, event_id: E })), r, {
    consume: async () => 'already_used',
  });
  assert.equal(r.code, 410);
});

test('session: si el consumidor ya no existe → 404 y el enlace se libera', async () => {
  let released = 0;
  const r = res();
  await redeemConsumerSession(reqWith(linkFor({ consumer_id: C, event_id: E })), r, {
    UserModel: userModel(null),
    consume: async () => 'consumed',
    release: async () => { released++; },
  });
  assert.equal(r.code, 404);
  assert.equal(released, 1);
});

// ─── solo desde la app del consumidor (decisión 2026-10-22) ─────────────────

const { isConsumerOrigin, requireConsumerOrigin } = require('../helpers/consumerToken');
const withOrigin = (origin) => ({ header: (n) => (n === 'origin' ? origin : undefined) });

test('solo https://app.devitrak.net cuenta como la app del consumidor', () => {
  delete process.env.CONSUMER_ORIGINS;
  assert.equal(isConsumerOrigin(withOrigin('https://app.devitrak.net')), true);
  for (const o of ['https://admin.devitrak.net', 'https://evil.example', undefined, 'http://app.devitrak.net']) {
    assert.equal(isConsumerOrigin(withOrigin(o)), false, String(o));
  }
});

test('CONSUMER_ORIGINS sustituye la lista (p. ej. el localhost de desarrollo)', () => {
  process.env.CONSUMER_ORIGINS = 'https://app.devitrak.net, http://localhost:3791';
  assert.equal(isConsumerOrigin(withOrigin('http://localhost:3791')), true);
  delete process.env.CONSUMER_ORIGINS;
  assert.equal(isConsumerOrigin(withOrigin('http://localhost:3791')), false);
});

test('pedir y canjear el enlace: 403 fuera de la app del consumidor', () => {
  const r = res();
  let passed = false;
  requireConsumerOrigin(withOrigin('https://admin.devitrak.net'), r, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(r.code, 403);

  const router = require('../routes/auth');
  for (const p of ['/consumer-login-link', '/consumer-session']) {
    const layer = router.stack.find((l) => l.route?.path === p && l.route.methods.post);
    assert.equal(layer.route.stack[0].handle, requireConsumerOrigin, p);
  }
});
