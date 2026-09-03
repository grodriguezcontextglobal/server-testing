'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

// Access control for /api/nodemailer/*. The namespace has always been open;
// per-company branding made that worse, because `x-company-id` is a header the
// caller writes. See middlewares/notificationAuth.js.
const {
  PUBLIC_ROUTES,
  attachVerifiedCompany,
  requireNotificationAuth,
  verifyCompanyMembership,
  clearMembershipCache,
  isPublicRoute,
  readSession,
} = require('../middlewares/notificationAuth');

const UID = '68d0000000000000000a0001';
const COMPANY = '68d0000000000000000b0002';
const OTHER_COMPANY = '68d0000000000000000b9999';

const signed = (payload = {}) =>
  jwt.sign({ uid: UID, name: 'Ana', ...payload }, process.env.SECRET_JWT_SEED, { expiresIn: '2h' });

function makeRequest({ headers = {}, path = '/member-lease-return-device-notification' } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    path,
    ip: '203.0.113.7',
    headers: lower,
    header: (name) => lower[String(name).toLowerCase()],
  };
}

function makeResponse() {
  const res = {};
  res.status = (code) => { res.code = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const runMiddleware = async (middleware, request, response = makeResponse()) => {
  let nexted = false;
  await middleware(request, response, () => { nexted = true; });
  return { nexted, response };
};

const deps = (opts = {}) => ({
  findUser: async () => ({ email: 'ana@bridgespcs.org' }),
  findCompany: async (filter) => filter._id === COMPANY,
  ...opts,
});

/* ---------------------------------------------------------------- *
 * Membership
 * ---------------------------------------------------------------- */

test('verifyCompanyMembership: accepts a company the user has an employee record in', async () => {
  clearMembershipCache();
  assert.equal(await verifyCompanyMembership(UID, COMPANY, deps()), true);
});

test('verifyCompanyMembership: refuses a company the user does not belong to', async () => {
  clearMembershipCache();
  assert.equal(await verifyCompanyMembership(UID, OTHER_COMPANY, deps()), false);
});

test('verifyCompanyMembership: asks the same question login asks', async () => {
  clearMembershipCache();
  let filter;
  await verifyCompanyMembership(UID, COMPANY, deps({
    findCompany: async (f) => { filter = f; return true; },
  }));
  // Login resolves companies with Company.find({"employees.user": email}); if
  // these two ever disagree, a user could be signed in to a company this
  // refuses to let them send mail for.
  assert.deepEqual(filter, { _id: COMPANY, 'employees.user': 'ana@bridgespcs.org' });
});

test('verifyCompanyMembership: refuses a malformed company id without querying', async () => {
  clearMembershipCache();
  let queried = false;
  const probe = deps({ findCompany: async () => { queried = true; return true; } });
  assert.equal(await verifyCompanyMembership(UID, 'not-an-id', probe), false);
  assert.equal(await verifyCompanyMembership(UID, '', probe), false);
  assert.equal(await verifyCompanyMembership(null, COMPANY, probe), false);
  assert.equal(queried, false);
});

test('verifyCompanyMembership: an unknown user is not a member of anything', async () => {
  clearMembershipCache();
  assert.equal(
    await verifyCompanyMembership(UID, COMPANY, deps({ findUser: async () => null })),
    false
  );
});

test('verifyCompanyMembership: caches, so a burst of emails is not a burst of queries', async () => {
  clearMembershipCache();
  let calls = 0;
  const probe = deps({ findCompany: async () => { calls += 1; return true; } });
  await verifyCompanyMembership(UID, COMPANY, probe);
  await verifyCompanyMembership(UID, COMPANY, probe);
  assert.equal(calls, 1);
});

/* ---------------------------------------------------------------- *
 * attachVerifiedCompany
 * ---------------------------------------------------------------- */

test('attachVerifiedCompany: a valid session claiming its own company is verified', async () => {
  clearMembershipCache();
  const request = makeRequest({ headers: { 'x-token': signed(), 'x-company-id': COMPANY } });
  const { nexted } = await runMiddleware(attachVerifiedCompany(deps()), request);
  assert.equal(nexted, true);
  assert.equal(request.verifiedCompanyId, COMPANY);
});

test('attachVerifiedCompany: claiming someone else\'s company leaves nothing verified', async () => {
  clearMembershipCache();
  const request = makeRequest({ headers: { 'x-token': signed(), 'x-company-id': OTHER_COMPANY } });
  await runMiddleware(attachVerifiedCompany(deps()), request);
  assert.equal(request.verifiedCompanyId, undefined);
});

test('attachVerifiedCompany: a header with no token verifies nothing', async () => {
  clearMembershipCache();
  const request = makeRequest({ headers: { 'x-company-id': COMPANY } });
  await runMiddleware(attachVerifiedCompany(deps()), request);
  assert.equal(request.verifiedCompanyId, undefined);
  assert.equal(request.notificationSession, null);
});

test('attachVerifiedCompany: a forged token verifies nothing', async () => {
  clearMembershipCache();
  const forged = jwt.sign({ uid: UID }, 'not-the-real-seed');
  const request = makeRequest({ headers: { 'x-token': forged, 'x-company-id': COMPANY } });
  await runMiddleware(attachVerifiedCompany(deps()), request);
  assert.equal(request.notificationSession, null);
  assert.equal(request.verifiedCompanyId, undefined);
});

test('attachVerifiedCompany: an expired token verifies nothing', async () => {
  clearMembershipCache();
  const expired = jwt.sign({ uid: UID }, process.env.SECRET_JWT_SEED, { expiresIn: -10 });
  const request = makeRequest({ headers: { 'x-token': expired, 'x-company-id': COMPANY } });
  await runMiddleware(attachVerifiedCompany(deps()), request);
  assert.equal(request.verifiedCompanyId, undefined);
});

test('attachVerifiedCompany: a database failure costs the branding, never the email', async () => {
  clearMembershipCache();
  const request = makeRequest({ headers: { 'x-token': signed(), 'x-company-id': COMPANY } });
  const { nexted } = await runMiddleware(
    attachVerifiedCompany(deps({ findUser: async () => { throw new Error('mongo down'); } })),
    request
  );
  assert.equal(nexted, true, 'the send must still proceed');
  assert.equal(request.verifiedCompanyId, undefined);
});

/** Reload the module under a given mode; `undefined` means the variable is unset. */
const loadWithMode = (mode) => {
  const path = require.resolve('../middlewares/notificationAuth');
  const previous = process.env.NODEMAILER_AUTH_MODE;
  if (mode === undefined) delete process.env.NODEMAILER_AUTH_MODE;
  else process.env.NODEMAILER_AUTH_MODE = mode;
  delete require.cache[path];
  const loaded = require('../middlewares/notificationAuth');
  delete require.cache[path];
  if (previous === undefined) delete process.env.NODEMAILER_AUTH_MODE;
  else process.env.NODEMAILER_AUTH_MODE = previous;
  return loaded;
};

/* ---------------------------------------------------------------- *
 * requireNotificationAuth
 * ---------------------------------------------------------------- */

test('requireNotificationAuth: an unset NODEMAILER_AUTH_MODE observes, it does not refuse', () => {
  // An environment nobody configured must not start refusing traffic on its
  // own. Asserted by reloading with the variable deleted rather than by relying
  // on the module-level import: a local .env sets it, which would otherwise make
  // this pass for the wrong reason.
  const { requireNotificationAuth: byDefault } = loadWithMode(undefined);
  const response = makeResponse();
  let nexted = false;
  byDefault(makeRequest(), response, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(response.code, undefined);
});

test('requireNotificationAuth: warn observes without blocking', () => {
  const { requireNotificationAuth: warn } = loadWithMode('warn');
  const response = makeResponse();
  let nexted = false;
  warn(makeRequest(), response, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(response.code, undefined);
});

test('requireNotificationAuth: an authenticated request passes', () => {
  const request = makeRequest({ headers: { 'x-token': signed() } });
  request.notificationSession = { uid: UID };
  let nexted = false;
  requireNotificationAuth(request, makeResponse(), () => { nexted = true; });
  assert.equal(nexted, true);
});

test('the pre-login routes are exactly the four that cannot hold a token', () => {
  assert.deepEqual([...PUBLIC_ROUTES.keys()].sort(), [
    '/confirmation-account',
    '/forcing-revoking-active-session',
    '/login-existing-consumer',
    '/reset-admin-password',
  ]);
  assert.equal(isPublicRoute(makeRequest({ path: '/reset-admin-password' })), true);
  assert.equal(isPublicRoute(makeRequest({ path: '/reset-admin-password/' })), true);
  assert.equal(isPublicRoute(makeRequest({ path: '/member-email-notification' })), false);
});

test('readSession: reads the token whether the request exposes header() or headers', () => {
  const token = signed();
  assert.equal(readSession(makeRequest({ headers: { 'x-token': token } })).uid, UID);
  assert.equal(readSession({ headers: { 'x-token': token } }).uid, UID);
  assert.equal(readSession({ headers: {} }), null);
});

/* ---------------------------------------------------------------- *
 * enforce mode
 *
 * MODE is read once at module load, so these reload the module under a
 * different environment rather than mutating a shared value.
 * ---------------------------------------------------------------- */


test('enforce: an unauthenticated send is refused with 401', () => {
  const { requireNotificationAuth: enforce } = loadWithMode('enforce');
  const response = makeResponse();
  let nexted = false;
  enforce(makeRequest(), response, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(response.code, 401);
  assert.equal(response.body.ok, false);
});

test('enforce: an authenticated send passes', () => {
  const { requireNotificationAuth: enforce } = loadWithMode('enforce');
  const request = makeRequest();
  request.notificationSession = { uid: UID };
  let nexted = false;
  enforce(request, makeResponse(), () => { nexted = true; });
  assert.equal(nexted, true);
});

test('enforce: the pre-login routes still answer — locking these breaks sign-in', () => {
  const { requireNotificationAuth: enforce } = loadWithMode('enforce');
  for (const route of [
    '/reset-admin-password',
    '/forcing-revoking-active-session',
    '/confirmation-account',
    '/login-existing-consumer',
  ]) {
    const response = makeResponse();
    let nexted = false;
    enforce(makeRequest({ path: route }), response, () => { nexted = true; });
    assert.equal(nexted, true, `${route} must stay reachable without a token`);
    assert.equal(response.code, undefined);
  }
});

test('off: nothing is refused, for a fast rollback without a deploy', () => {
  const { requireNotificationAuth: off } = loadWithMode('off');
  let nexted = false;
  off(makeRequest(), makeResponse(), () => { nexted = true; });
  assert.equal(nexted, true);
});

// ─── Límite de las rutas públicas de asistente ──────────────────────────────
// El limitador público iba por IP para las cuatro rutas. En un evento todos los
// asistentes están detrás del wifi del venue, o sea UNA sola IP pública, así que
// 10/15min bloqueaba al asistente número once. Las dos rutas de asistente ahora
// se cuentan por email destino; las dos de staff siguen por IP.

const {
  CONSUMER_PUBLIC_ROUTES,
  isConsumerPublicRoute,
  consumerRateLimitKey,
  publicRouteRateLimit,
} = require('../middlewares/notificationAuth');

const VENUE_IP = '198.51.100.20';

function makeLimiterRequest({ path, email, ip = VENUE_IP } = {}) {
  return {
    path,
    ip,
    method: 'POST',
    headers: {},
    header: () => undefined,
    body: email === undefined ? {} : { consumer: { email } },
  };
}

function makeLimiterResponse() {
  const res = { headersSent: false, blocked: false };
  res.status = (code) => { res.code = code; return res; };
  res.json = (body) => { res.body = body; res.blocked = true; return res; };
  res.send = res.json;
  res.setHeader = () => res;
  res.getHeader = () => undefined;
  res.removeHeader = () => res;
  return res;
}

const runLimiter = (request) =>
  new Promise((resolve) => {
    const response = makeLimiterResponse();
    const done = () => resolve({ response, passed: !response.blocked });
    const result = publicRouteRateLimit(request, response, done);
    if (result && typeof result.then === 'function') result.then(() => { if (response.blocked) done(); });
  });

test('las dos rutas de asistente están marcadas, las de staff no', () => {
  assert.equal(CONSUMER_PUBLIC_ROUTES.size, 2);
  assert.equal(isConsumerPublicRoute({ path: '/confirmation-account' }), true);
  assert.equal(isConsumerPublicRoute({ path: '/login-existing-consumer' }), true);
  assert.equal(isConsumerPublicRoute({ path: '/reset-admin-password' }), false);
  // Y siguen siendo públicas: el cambio es de clave, no de acceso.
  for (const route of CONSUMER_PUBLIC_ROUTES) {
    assert.equal(isPublicRoute({ path: route }), true);
  }
});

test('la clave sale del email destino, normalizado', () => {
  assert.equal(
    consumerRateLimitKey(makeLimiterRequest({ email: '  Ana@Example.COM ' })),
    'email:ana@example.com'
  );
});

test('sin email usable cae a la IP: un body malformado no compra una ruta ilimitada', () => {
  assert.equal(consumerRateLimitKey(makeLimiterRequest({})), `ip:${VENUE_IP}`);
  assert.equal(consumerRateLimitKey(makeLimiterRequest({ email: '   ' })), `ip:${VENUE_IP}`);
  assert.equal(consumerRateLimitKey({ ip: VENUE_IP, body: undefined }), `ip:${VENUE_IP}`);
});

test('LA REGRESIÓN: 12 asistentes distintos en el wifi del venue pasan todos', async () => {
  for (let i = 0; i < 12; i += 1) {
    const { passed } = await runLimiter(
      makeLimiterRequest({ path: '/login-existing-consumer', email: `asistente${i}@example.com` })
    );
    assert.equal(passed, true, `el asistente ${i + 1} debe recibir su link de login`);
  }
});

test('martillar UNA dirección sigue bloqueado: es la señal de abuso real', async () => {
  const victim = 'objetivo@example.com';
  let blockedAt = null;
  for (let i = 1; i <= 8 && blockedAt === null; i += 1) {
    const { passed } = await runLimiter(
      makeLimiterRequest({ path: '/confirmation-account', email: victim })
    );
    if (!passed) blockedAt = i;
  }
  assert.ok(blockedAt !== null, 'repetir la misma dirección debe cortarse');
  assert.ok(blockedAt <= 6, `debía cortarse dentro del presupuesto de 5, cortó en ${blockedAt}`);
});

test('las rutas de staff siguen contando por IP', async () => {
  let blockedAt = null;
  for (let i = 1; i <= 14 && blockedAt === null; i += 1) {
    const { passed } = await runLimiter(makeLimiterRequest({ path: '/reset-admin-password' }));
    if (!passed) blockedAt = i;
  }
  assert.ok(blockedAt !== null, 'la ruta de staff debe seguir limitada por IP');
  assert.ok(blockedAt <= 11, `debía cortarse dentro del presupuesto de 10, cortó en ${blockedAt}`);
});
