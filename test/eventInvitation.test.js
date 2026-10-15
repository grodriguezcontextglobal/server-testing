'use strict';

/**
 * Invitación a un evento con enlace firmado de un solo uso — Fase 4.3 de
 * PLAN_rutas_sin_autenticacion_2026-10-14.md.
 *
 * Antes el enlace lo armaba el navegador con todos los datos en claro y la
 * página confirmaba con las rutas genéricas de consumidor: cualquiera podía
 * apuntar a quien quisiera a un evento. Ahora el servidor saca los datos de la
 * BD, firma el enlace y confirma con lo que dice el token.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

// ── ids ─────────────────────────────────────────────────────────────────────
const CO = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_CO = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const EVENT = 'eeeeeeeeeeeeeeeeeeeeeee1';
const OTHER_EVENT = 'eeeeeeeeeeeeeeeeeeeeeee2';
const STAFF = '111111111111111111111111';
const OUTSIDER = '222222222222222222222222';

// ── estado ──────────────────────────────────────────────────────────────────
let state;
const reset = () => {
  state = {
    enqueued: [],
    logs: [],
    sql: [],
    users: [],
    updates: [],
    created: [],
    redisKeys: new Set(),
    failCreate: false,
  };
};
reset();

const chain = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });
const events = {
  [EVENT]: { _id: EVENT, company_id: CO, eventInfoDetail: { eventName: 'Science Fair', dateBegin: '2026-11-01' } },
  [OTHER_EVENT]: { _id: OTHER_EVENT, company_id: OTHER_CO, eventInfoDetail: { eventName: 'Other' } },
};
stub('models/Event.js', {
  findById: (id) => chain(events[id] ?? null),
  findOne: ({ _id, company_id }) => chain(events[_id] && events[_id].company_id === company_id ? events[_id] : null),
});
stub('models/Company.js', {
  findById: (id) => chain(id === CO ? { _id: CO, company_name: 'Lincoln High' } : null),
  findOne: () => ({ lean: async () => ({ employees: [{ userId: STAFF, user: 'staff@co.com' }] }) }),
});
const admins = {
  [STAFF]: { _id: STAFF, email: 'staff@co.com', active: true, tokenVersion: 1 },
  [OUTSIDER]: { _id: OUTSIDER, email: 'out@x.com', active: true, tokenVersion: 1 },
};
stub('models/AdminUser.js', { findById: (id) => chain(admins[id] ?? null) });
stub('models/User.js', {
  findOne: ({ email }) => ({
    sort: async () => [...state.users].reverse().find((u) => u.email === email) ?? null,
  }),
  updateOne: async (filter, update) => {
    state.updates.push({ filter, update });
    const user = state.users.find((u) => u._id === filter._id);
    for (const [k, v] of Object.entries(update.$addToSet)) {
      if (!user[k].includes(v)) user[k].push(v);
    }
  },
  create: async (doc) => {
    if (state.failCreate) throw new Error('mongo down');
    state.created.push(doc);
    state.users.push({ _id: `u${state.users.length}`, ...doc });
  },
});

const MEMBERS = [
  { member_id: 10, first_name: 'Ana', last_name: 'Diaz', email: 'ana@school.org', minor: 0, parent_guardian_email: null },
  { member_id: 11, first_name: 'Leo', last_name: 'Ruiz', email: 'leo@school.org', minor: 1, parent_guardian_email: 'mom@home.com' },
  { member_id: 12, first_name: 'Sam', last_name: 'Kim', email: 'sam@school.org', minor: 1, parent_guardian_email: '' },
];
stub('mysql/database/config.js', () => ({
  query: async (sql, params) => {
    state.sql.push({ sql, params });
    const [companyId, ids] = params;
    return [companyId === '7' ? MEMBERS.filter((m) => ids.includes(String(m.member_id))) : []];
  },
  execute: async (sql, params) => { state.sql.push({ sql, params }); return [{}]; },
}));
stub('helpers/queue.js', {
  enqueue: async (type, payload) => { state.enqueued.push({ type, payload }); return { id: 'J' }; },
  extractJobContext: () => ({}),
});
stub('controller/staffActivityLog.js', { logStaffActivity: async (entry) => { state.logs.push(entry); } });
stub('helpers/logger.js', { warn: () => {}, error: () => {}, info: () => {} });
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => ({
    set: async (k, _v, opts) => {
      if (opts?.NX && state.redisKeys.has(k)) return null;
      state.redisKeys.add(k);
      return 'OK';
    },
    del: async (k) => state.redisKeys.delete(k),
  }),
});

const {
  sendEventInvitations,
  confirmEventInvitation,
  recordEventInvitationResponse,
  EVENT_ATTENDANCE_PURPOSE,
} = require('../controller/eventInvitation');
const { readEmailLinkToken, signEmailLinkToken } = require('../helpers/emailLinkToken');
const { requireSessionFromDashboard } = require('../middlewares/attendanceLinkAuth');

const req = ({ body = {}, uid, tokenVersion, token, origin } = {}) => {
  const headers = { ...(token ? { 'x-link-token': token } : {}), ...(origin ? { origin } : {}) };
  return { body, uid, tokenVersion, headers, header: (n) => headers[n.toLowerCase()], ip: '1.1.1.1', originalUrl: '/x' };
};
const res = () => {
  const r = {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const call = async (fn, request) => { const r = res(); await fn(request, r); return r; };

const linkOf = (payload) => payload.html.match(/href="([^"]*attendance-confirmation[^"]*)"/)[1].replace(/&amp;/g, '&');
const tokenOf = (payload) => new URL(linkOf(payload)).searchParams.get('token');

const claims = (over = {}) => ({
  company_id: CO,
  company_name: 'Lincoln High',
  event_id: EVENT,
  event_name: 'Science Fair',
  member_id: '10',
  member_email: 'ana@school.org',
  member_first_name: 'Ana',
  member_last_name: 'Diaz',
  responder_email: 'ana@school.org',
  responder_role: 'member',
  ...over,
});
const tokenFor = (over) => signEmailLinkToken(EVENT_ATTENDANCE_PURPOSE, claims(over));

// ═══ send ═══════════════════════════════════════════════════════════════════

test('send: valida event_id y member_ids', async () => {
  reset();
  assert.equal((await call(sendEventInvitations, req({ uid: STAFF, body: { event_id: 'x', member_ids: [1] } }))).code, 400);
  assert.equal((await call(sendEventInvitations, req({ uid: STAFF, body: { event_id: EVENT, member_ids: [] } }))).code, 400);
  const many = Array.from({ length: 501 }, (_, i) => i);
  assert.equal((await call(sendEventInvitations, req({ uid: STAFF, body: { event_id: EVENT, member_ids: many } }))).code, 400);
});

test('send: el evento de una compañía a la que no perteneces da 404 y no envía nada', async () => {
  reset();
  const r = await call(sendEventInvitations, req({ uid: OUTSIDER, body: { company_id: '7', event_id: OTHER_EVENT, member_ids: [10] } }));
  assert.equal(r.code, 404);
  assert.equal(state.enqueued.length, 0);
});

test('send: destinatario y datos salen de la BD; al menor le llega a su tutor', async () => {
  reset();
  const r = await call(
    sendEventInvitations,
    req({ uid: STAFF, body: { company_id: '7', event_id: EVENT, member_ids: [10, 11, 12, 99], email: 'atacante@x.com' } }),
  );
  assert.equal(r.code, 200);
  assert.equal(r.body.sent, 2);
  const byId = Object.fromEntries(r.body.results.map((x) => [x.member_id, x]));
  assert.match(byId['12'].error, /guardian/);
  assert.match(byId['99'].error, /not found/);

  const [adult, minor] = state.enqueued.map((e) => e.payload);
  assert.equal(adult.to, 'ana@school.org');
  assert.equal(minor.to, 'mom@home.com');

  const c = readEmailLinkToken(EVENT_ATTENDANCE_PURPOSE, tokenOf(minor));
  assert.equal(c.responder_role, 'guardian');
  assert.equal(c.responder_email, 'mom@home.com');
  assert.equal(c.member_email, 'leo@school.org');
  assert.equal(c.event_name, 'Science Fair', 'el nombre del evento sale de la BD');
  assert.equal(c.company_id, CO, 'la compañía es la dueña del evento');
  assert.ok(c.exp - c.iat <= 5 * 24 * 3600);

  assert.equal(state.sql[0].params[0], '7');
  assert.deepEqual(state.sql[0].params[1], ['10', '11', '12', '99']);
});

test('send: el enlace conserva los parámetros que la página muestra', async () => {
  reset();
  await call(sendEventInvitations, req({ uid: STAFF, body: { company_id: '7', event_id: EVENT, member_ids: [11] } }));
  const url = new URL(linkOf(state.enqueued[0].payload));
  assert.equal(url.pathname, '/attendance-confirmation');
  assert.equal(url.searchParams.get('eventName'), 'Science Fair');
  assert.equal(url.searchParams.get('minor'), 'true');
  assert.equal(url.searchParams.get('guardianEmail'), 'mom@home.com');
  assert.equal(url.searchParams.get('companyId'), CO);
});

// ═══ confirm ════════════════════════════════════════════════════════════════

test('confirm: sin token o con uno inválido → 401, no escribe', async () => {
  reset();
  assert.equal((await call(confirmEventInvitation, req())).code, 401);
  assert.equal((await call(confirmEventInvitation, req({ token: 'basura' }))).code, 401);
  assert.equal(state.created.length + state.updates.length, 0);
});

test('confirm: consumidor nuevo → se crea en Mongo y en SQL con los datos del token', async () => {
  reset();
  const r = await call(confirmEventInvitation, req({ token: tokenFor(), body: { member_email: 'otro@x.com' } }));
  assert.equal(r.code, 200);
  assert.equal(r.body.outcome, 'confirmed');
  assert.equal(state.created[0].email, 'ana@school.org');
  assert.deepEqual(state.created[0].event_providers, [EVENT]);
  assert.ok(state.sql.some((q) => /INSERT INTO consumer_info/.test(q.sql)));
  const log = state.logs.at(-1);
  assert.equal(log.details.response, 'confirmed');
  assert.equal(log.details.verified, true);
  assert.equal(log.actor_type, 'anonymous');
  assert.equal(log.company_id, CO);
});

test('confirm: consumidor existente → se le añade el evento sin reemplazar sus arrays', async () => {
  reset();
  state.users.push({ _id: 'u0', email: 'ana@school.org', eventSelected: ['Old'], provider: ['X'], company_providers: [OTHER_CO], event_providers: [OTHER_EVENT] });
  const r = await call(confirmEventInvitation, req({ token: tokenFor() }));
  assert.equal(r.body.outcome, 'confirmed');
  assert.deepEqual(state.users[0].event_providers, [OTHER_EVENT, EVENT]);
  assert.ok(state.updates[0].update.$addToSet, 'usa $addToSet');
});

test('confirm: volver a pulsar → "already", sin escribir otra vez', async () => {
  reset();
  const t = tokenFor();
  await call(confirmEventInvitation, req({ token: t }));
  const writes = state.created.length;
  const r = await call(confirmEventInvitation, req({ token: t }));
  assert.equal(r.code, 200);
  assert.equal(r.body.outcome, 'already');
  assert.equal(state.created.length, writes);
  assert.equal(state.logs.at(-1).details.response, 'already_confirmed');
});

test('confirm: un token ya usado para alguien que no quedó en el evento → 410', async () => {
  reset();
  const t = tokenFor();
  await call(confirmEventInvitation, req({ token: t }));
  state.users.length = 0; // p. ej. lo borraron del evento después
  const r = await call(confirmEventInvitation, req({ token: t }));
  assert.equal(r.code, 410);
});

test('confirm: si falla la escritura, el token sigue valiendo y queda "failed"', async () => {
  reset();
  state.failCreate = true;
  const t = tokenFor();
  const r1 = await call(confirmEventInvitation, req({ token: t }));
  assert.equal(r1.code, 500);
  assert.equal(state.logs.at(-1).details.response, 'failed');
  state.failCreate = false;
  const r2 = await call(confirmEventInvitation, req({ token: t }));
  assert.equal(r2.body.outcome, 'confirmed');
});

// ═══ response ═══════════════════════════════════════════════════════════════

test('response con token: opened se registra verificado, con los datos del token', async () => {
  reset();
  const r = await call(
    recordEventInvitationResponse,
    req({ token: tokenFor({ responder_role: 'guardian', responder_email: 'mom@home.com' }), body: { response: 'opened', company_id: OTHER_CO } }),
  );
  assert.equal(r.code, 201);
  const log = state.logs.at(-1);
  assert.equal(log.action, 'OPEN');
  assert.equal(log.company_id, CO, 'ignora la compañía del body');
  assert.equal(log.actor.email, 'mom@home.com');
  assert.equal(log.details.verified, true);
});

test('response con token: confirmed/already_confirmed los registra /confirm, no el cliente', async () => {
  reset();
  assert.equal((await call(recordEventInvitationResponse, req({ token: tokenFor(), body: { response: 'confirmed' } }))).code, 400);
});

const legacyBody = (over = {}) => ({
  company_id: CO,
  event_id: EVENT,
  member_email: 'ana@school.org',
  responder_role: 'member',
  response: 'opened',
  ...over,
});

test('response sin token (enlace viejo, warn): se acepta como no verificada', async () => {
  reset();
  delete process.env.ATTENDANCE_LINK_MODE;
  const r = await call(recordEventInvitationResponse, req({ body: legacyBody() }));
  assert.equal(r.code, 201);
  assert.equal(state.logs.at(-1).details.verified, false);
  assert.equal(state.logs.at(-1).context.event_name, 'Science Fair', 'el nombre sale de la BD');
});

test('response sin token: evento de otra compañía → 404; campos inválidos → 400', async () => {
  reset();
  assert.equal((await call(recordEventInvitationResponse, req({ body: legacyBody({ event_id: OTHER_EVENT }) }))).code, 404);
  assert.equal((await call(recordEventInvitationResponse, req({ body: legacyBody({ event_id: 'x' }) }))).code, 400);
  assert.equal((await call(recordEventInvitationResponse, req({ body: legacyBody({ response: 'hacked' }) }))).code, 400);
  assert.equal(state.logs.length, 0);
});

test('response sin token en enforce → 401', async () => {
  reset();
  process.env.ATTENDANCE_LINK_MODE = 'enforce';
  try {
    assert.equal((await call(recordEventInvitationResponse, req({ body: legacyBody() }))).code, 401);
  } finally {
    delete process.env.ATTENDANCE_LINK_MODE;
  }
});

// ═══ rutas genéricas desde el dashboard sin sesión ══════════════════════════

const gate = async (request) => {
  let nexted = false;
  const r = res();
  await requireSessionFromDashboard(request, r, () => { nexted = true; });
  return { nexted, code: r.code };
};

test('rutas genéricas: la app del consumidor (sin token) siempre pasa', async () => {
  process.env.ATTENDANCE_LINK_MODE = 'enforce';
  try {
    assert.equal((await gate(req({ origin: 'https://app.devitrak.net' }))).nexted, true);
    assert.equal((await gate(req())).nexted, true, 'sin Origin (no navegador)');
  } finally {
    delete process.env.ATTENDANCE_LINK_MODE;
  }
});

test('rutas genéricas: dashboard sin sesión → warn deja pasar, enforce 401; con sesión pasa', async () => {
  delete process.env.ATTENDANCE_LINK_MODE;
  assert.equal((await gate(req({ origin: 'https://admin.devitrak.net' }))).nexted, true);
  process.env.ATTENDANCE_LINK_MODE = 'enforce';
  try {
    assert.equal((await gate(req({ origin: 'https://admin.devitrak.net' }))).code, 401);
    assert.equal((await gate(req({ origin: 'https://admin.devitrak.net', uid: STAFF, tokenVersion: 1 }))).nexted, true);
  } finally {
    delete process.env.ATTENDANCE_LINK_MODE;
  }
});

test('rutas: envío con sesión; confirm y response públicas con límite; las genéricas con el gate', () => {
  const { validateJWT } = require('../middlewares/validate-jwt');
  const { publicInvitationRateLimit } = require('../middlewares/attendanceLinkAuth');
  const chainOf = (mod, method, p) => {
    const layer = require(mod).stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    assert.ok(layer, `${method} ${p} no registrada`);
    return layer.route.stack.map((l) => l.handle);
  };
  assert.ok(chainOf('../mysql/routes/school', 'post', '/event-invitations/send').includes(validateJWT));
  for (const p of ['/event-invitations/confirm', '/event-invitations/response']) {
    const h = chainOf('../mysql/routes/school', 'post', p);
    assert.ok(h.includes(publicInvitationRateLimit));
    assert.ok(!h.includes(validateJWT));
  }
  assert.ok(chainOf('../routes/auth', 'post', '/new').includes(requireSessionFromDashboard));
  assert.ok(chainOf('../routes/auth', 'patch', '/:id').includes(requireSessionFromDashboard));
  assert.ok(chainOf('../routes/auth', 'post', '/user-query').includes(requireSessionFromDashboard));
  assert.ok(chainOf('../mysql/routes/consumers', 'post', '/new_consumer').includes(requireSessionFromDashboard));
});
