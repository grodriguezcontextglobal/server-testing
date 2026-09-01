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

/* ---------------------------------------------------------------- *
 * requireNotificationAuth
 * ---------------------------------------------------------------- */

test('requireNotificationAuth: warn mode (the default) never blocks', () => {
  // Deploying straight to enforce could silently stop customer email from
  // app.devitrak.net, whose source is not in this workspace. Default observes.
  const request = makeRequest();
  const response = makeResponse();
  let nexted = false;
  requireNotificationAuth(request, response, () => { nexted = true; });
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

const loadWithMode = (mode) => {
  const path = require.resolve('../middlewares/notificationAuth');
  const previous = process.env.NODEMAILER_AUTH_MODE;
  process.env.NODEMAILER_AUTH_MODE = mode;
  delete require.cache[path];
  const loaded = require('../middlewares/notificationAuth');
  delete require.cache[path];
  if (previous === undefined) delete process.env.NODEMAILER_AUTH_MODE;
  else process.env.NODEMAILER_AUTH_MODE = previous;
  return loaded;
};

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
