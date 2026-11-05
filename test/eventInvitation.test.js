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
    redisValues: new Map(),
    redisDown: false,
    failEnqueue: false,
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
  { member_id: 787, first_name: 'Sara', last_name: 'Mendoza', email: null, minor: 1, parent_guardian_email: 'jdow3@invoxia.cc' },
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
  enqueue: async (type, payload) => {
    if (state.failEnqueue) throw new Error('queue down');
    state.enqueued.push({ type, payload });
    return { id: 'J' };
  },
  extractJobContext: () => ({}),
});
stub('controller/staffActivityLog.js', { logStaffActivity: async (entry) => { state.logs.push(entry); } });
stub('helpers/logger.js', { warn: () => {}, error: () => {}, info: () => {} });
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => {
    if (state.redisDown) throw new Error('redis down');
    return {
      set: async (k, v, opts) => {
        if (opts?.NX && state.redisKeys.has(k)) return null;
        state.redisKeys.add(k);
        state.redisValues.set(k, v);
        return 'OK';
      },
      get: async (k) => state.redisValues.get(k) ?? null,
      del: async (k) => { state.redisValues.delete(k); return state.redisKeys.delete(k); },
    };
  },
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

// 2026-10-16: un menor sin email propio. El token salía con member_email "" y
// /confirm respondía 500 ("email is required"). La regla es la del dashboard
// (minorConsumerEmail.js): el email del tutor etiquetado con el id del miembro.
test('send: menor sin email propio → member_email es el del tutor etiquetado (+m<id>)', async () => {
  reset();
  await call(sendEventInvitations, req({ uid: STAFF, body: { company_id: '7', event_id: EVENT, member_ids: [787] } }));
  const payload = state.enqueued[0].payload;
  assert.equal(payload.to, 'jdow3@invoxia.cc', 'el correo le llega al tutor');
  const c = readEmailLinkToken(EVENT_ATTENDANCE_PURPOSE, tokenOf(payload));
  assert.equal(c.member_email, 'jdow3+m787@invoxia.cc');
});

// W2 (2026-10-16): un lote que corta a medias y se reintenta no puede escribir
// dos veces a la misma persona.
const sendTo = (memberIds, extra = {}) =>
  call(sendEventInvitations, req({ uid: STAFF, body: { company_id: '7', event_id: EVENT, member_ids: memberIds, ...extra } }));
const liveKeyOf = (memberId) => `eventinv:live:${EVENT}:${memberId}`;

test('send repetido: quien ya tiene invitación viva no recibe otro correo', async () => {
  reset();
  const first = await sendTo([10, 11]);
  assert.equal(first.body.sent, 2);
  assert.equal(state.enqueued.length, 2);

  const again = await sendTo([10, 11]);
  assert.equal(again.code, 200);
  assert.equal(state.enqueued.length, 2, 'ningún correo nuevo');
  assert.deepEqual(
    { sent: again.body.sent, skipped: again.body.skipped, failed: again.body.failed },
    { sent: 0, skipped: 2, failed: 0 },
  );
  assert.deepEqual(again.body.results.map((r) => r.skipped), ['already_invited', 'already_invited']);
  assert.ok(again.body.results.every((r) => r.ok), 'saltado cuenta como ok: no es un fallo para el cliente');
});

test('send repetido con uno nuevo en el lote: solo se envía al nuevo', async () => {
  reset();
  await sendTo([10]);
  const r = await sendTo([10, 11]);
  assert.equal(r.body.sent, 1);
  assert.equal(r.body.skipped, 1);
  assert.equal(state.enqueued.at(-1).payload.to, 'mom@home.com');
});

test('send: la invitación viva guarda el jti del enlace hasta que caduca', async () => {
  reset();
  await sendTo([10]);
  const stored = JSON.parse(state.redisValues.get(liveKeyOf('10')));
  const c = readEmailLinkToken(EVENT_ATTENDANCE_PURPOSE, tokenOf(state.enqueued[0].payload));
  assert.deepEqual(stored, { jti: c.jti, exp: c.exp });
});

test('resend: true → enlace nuevo y el anterior deja de valer', async () => {
  reset();
  await sendTo([10]);
  const oldToken = tokenOf(state.enqueued[0].payload);

  const r = await sendTo([10], { resend: true });
  assert.equal(r.body.sent, 1);
  assert.equal(state.enqueued.length, 2);
  const newToken = tokenOf(state.enqueued[1].payload);
  assert.notEqual(newToken, oldToken);

  const viejo = await call(confirmEventInvitation, req({ token: oldToken }));
  assert.equal(viejo.code, 410, 'el enlace anterior ya no confirma');
  const nuevo = await call(confirmEventInvitation, req({ token: newToken }));
  assert.equal(nuevo.body.outcome, 'confirmed');
});

test('send: si no se pudo encolar, no queda como invitación viva (el reintento sí envía)', async () => {
  reset();
  state.failEnqueue = true;
  const r1 = await sendTo([10]);
  assert.equal(r1.body.failed, 1);
  assert.equal(state.redisKeys.has(liveKeyOf('10')), false);

  state.failEnqueue = false;
  const r2 = await sendTo([10]);
  assert.equal(r2.body.sent, 1);
});

test('send: sin Redis se envía igual (y se repite: preferimos eso a no enviar)', async () => {
  reset();
  state.redisDown = true;
  await sendTo([10]);
  await sendTo([10]);
  assert.equal(state.enqueued.length, 2);
});

// ═══ confirm ════════════════════════════════════════════════════════════════

test('confirm: enlace viejo con member_email vacío (menor) → crea el consumidor con el email del tutor etiquetado', async () => {
  reset();
  state.users.push({ _id: 'u-empty', email: '', event_providers: [] }); // otro consumidor sin email: no se puede tocar
  const token = tokenFor({
    member_id: '787', member_email: '', member_first_name: 'Sara', member_last_name: 'Mendoza',
    responder_email: 'jdow3@invoxia.cc', responder_role: 'guardian',
  });
  const r = await call(confirmEventInvitation, req({ token }));
  assert.equal(r.code, 200);
  assert.equal(r.body.outcome, 'confirmed');
  assert.equal(state.created[0].email, 'jdow3+m787@invoxia.cc');
  assert.deepEqual(state.users[0].event_providers, [], 'el consumidor con email vacío no se toca');
  const insert = state.sql.find((q) => /INSERT INTO consumer_info/.test(q.sql));
  assert.equal(insert.params[2], 'jdow3+m787@invoxia.cc');
});

test('confirm: sin email ni tutor del que deducirlo → 422, no escribe ni gasta el token', async () => {
  reset();
  const token = tokenFor({ member_email: '', responder_role: 'member' });
  const r = await call(confirmEventInvitation, req({ token }));
  assert.equal(r.code, 422);
  assert.equal(state.created.length + state.updates.length, 0);
  assert.equal(state.redisKeys.size, 0, 'el token sigue sin usar');
  assert.equal(state.logs.at(-1).details.response, 'failed');
});

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
