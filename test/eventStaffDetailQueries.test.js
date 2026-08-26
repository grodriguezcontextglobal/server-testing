'use strict';

/**
 * Regresión de rendimiento de GET /api/event/event-staff-detail/:id y de la
 * invalidación de su caché.
 *
 * Tres defectos que cubre:
 * 1. N+1: era un AdminUser.findOne() por miembro del staff, secuencial.
 * 2. La caché se borraba en el HIT (`del` antes de responder), así que cada
 *    entrada servía una sola petición y el TTL no se usaba nunca.
 * 3. editEvent invalidaba `event_staff_info=${request.body.id}` — el cliente no
 *    manda `id` en el body de PATCH /edit-staff-event/:id, así que borraba la
 *    clave `...=undefined` y la entrada real quedaba viva.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const stub = (rel, exports) => {
  const filename = resolve(rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

// ─── Espías ──────────────────────────────────────────────────────────────────
const calls = { findOne: 0, find: [], redis: [] };

const redisFake = {
  get: async (key) => {
    calls.redis.push(['get', key]);
    return redisFake._value;
  },
  set: async (key, value, opts) => {
    calls.redis.push(['set', key, opts]);
    redisFake._value = value;
  },
  del: async (key) => {
    calls.redis.push(['del', key]);
  },
  expire: async (key, ttl) => {
    calls.redis.push(['expire', key, ttl]);
  },
  _value: null,
};

const EventStub = {
  _event: null,
  findById: async () => EventStub._event,
  findByIdAndUpdate: async (id, body) => ({ id, ...body, company_id: 'C1' }),
};

const AdminUserStub = {
  _rows: [],
  find: async (filter, projection) => {
    calls.find.push({ filter, projection });
    const wanted = filter?.email?.$in ?? [];
    return AdminUserStub._rows.filter((r) => wanted.includes(r.email));
  },
  findOne: async () => {
    calls.findOne += 1;
    return null;
  },
};

stub('models/Event.js', EventStub);
stub('models/AdminUser.js', AdminUserStub);
stub('models/ReceiversPool.js', {});
stub('database/cacheMemoryConfig.js', { clientRedis: async () => redisFake });
stub('helpers/logger.js', { error: () => {}, warn: () => {}, info: () => {} });
stub('controller/staffActivityLog.js', { logStaffActivity: async () => {} });
stub('mysql/database/config.js', () => ({ query: async () => [[]], execute: async () => [[]] }));

const { eventStaffDetailInfo, editEvent } = require('../controller/event');

const makeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const reset = () => {
  calls.findOne = 0;
  calls.find.length = 0;
  calls.redis.length = 0;
  redisFake._value = null;
};

// ─── 1. El N+1 ───────────────────────────────────────────────────────────────

test('eventStaffDetailInfo: una sola query con $in por todo el staff (no un findOne por persona)', async () => {
  reset();
  EventStub._event = {
    staff: {
      adminUser: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
      headsetAttendees: [{ email: 'c@x.com' }, { email: 'd@x.com' }],
    },
  };
  AdminUserStub._rows = [
    { email: 'a@x.com', imageProfile: 'foto-a', phone: '111', id: 'A1' },
    { email: 'c@x.com', imageProfile: 'foto-c', phone: '333', id: 'C1' },
  ];

  const res = makeRes();
  await eventStaffDetailInfo({ params: { id: 'EV1' } }, res);

  assert.equal(calls.findOne, 0, 'no debe quedar ningún findOne por miembro');
  assert.equal(calls.find.length, 1, 'debe ser UNA sola query para los 4 emails');
  assert.deepEqual(calls.find[0].filter, {
    email: { $in: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'] },
  });

  const staff = JSON.parse(res.body.staff);
  assert.equal(staff.length, 4, 'devuelve una fila por miembro, encontrado o no');
  assert.deepEqual(
    staff.map((s) => s.admin_id),
    ['A1', null, 'C1', null],
    'preserva el orden del staff y rellena los que no tienen AdminUser'
  );
  assert.equal(staff[0].photo, 'foto-a');
  assert.equal(staff[1].photo, null);
  assert.equal(staff[1].phone, '');
});

test('eventStaffDetailInfo: staff vacío no dispara ninguna query a AdminUser', async () => {
  reset();
  EventStub._event = { staff: { adminUser: [], headsetAttendees: [] } };
  const res = makeRes();
  await eventStaffDetailInfo({ params: { id: 'EV1' } }, res);
  assert.equal(calls.find.length, 0);
  assert.deepEqual(JSON.parse(res.body.staff), []);
});

test('eventStaffDetailInfo: emails repetidos entre adminUser y headsetAttendees se piden una vez', async () => {
  reset();
  EventStub._event = {
    staff: { adminUser: [{ email: 'a@x.com' }], headsetAttendees: [{ email: 'a@x.com' }] },
  };
  AdminUserStub._rows = [{ email: 'a@x.com', imageProfile: 'f', phone: '1', id: 'A1' }];
  const res = makeRes();
  await eventStaffDetailInfo({ params: { id: 'EV1' } }, res);
  assert.deepEqual(calls.find[0].filter, { email: { $in: ['a@x.com'] } });
  // pero siguen saliendo las 2 filas del staff
  assert.equal(JSON.parse(res.body.staff).length, 2);
});

// ─── 2. La caché sobrevive a la lectura ──────────────────────────────────────

test('eventStaffDetailInfo: el HIT de caché NO borra la entrada', async () => {
  reset();
  redisFake._value = JSON.stringify([{ staff: { email: 'a@x.com' } }]);

  const res = makeRes();
  await eventStaffDetailInfo({ params: { id: 'EV7' } }, res);

  assert.equal(res.body.cached, true);
  const dels = calls.redis.filter(([op]) => op === 'del');
  assert.equal(dels.length, 0, 'un hit de lectura no debe invalidar la caché');
  assert.equal(calls.find.length, 0, 'y no debe ir a Mongo');
});

test('eventStaffDetailInfo: el MISS guarda con TTL en una sola llamada (set + EX)', async () => {
  reset();
  EventStub._event = { staff: { adminUser: [{ email: 'a@x.com' }], headsetAttendees: [] } };
  AdminUserStub._rows = [];

  const res = makeRes();
  await eventStaffDetailInfo({ params: { id: 'EV9' } }, res);

  const sets = calls.redis.filter(([op]) => op === 'set');
  assert.equal(sets.length, 1);
  assert.equal(sets[0][1], 'event_staff_info=EV9');
  assert.ok(sets[0][2] && sets[0][2].EX > 0, 'el set debe llevar TTL como red de seguridad');
  assert.equal(
    calls.redis.filter(([op]) => op === 'expire').length,
    0,
    'el TTL va en el set, sin un segundo viaje a Redis'
  );
});

// ─── 3. La invalidación usa el id de la ruta ─────────────────────────────────

test('editEvent: invalida event_staff_info con el id de la RUTA, aunque el body no traiga id', async () => {
  reset();
  EventStub._event = { id: 'EV42' };

  const res = makeRes();
  await editEvent(
    {
      params: { id: 'EV42' },
      body: { staff: { adminUser: [], headsetAttendees: [] }, company: 'C1', type: 'event' },
      headers: {},
    },
    res
  );

  const dels = calls.redis.filter(([op]) => op === 'del').map(([, key]) => key);
  assert.ok(
    dels.includes('event_staff_info=EV42'),
    `esperaba invalidar event_staff_info=EV42, se invalidó: ${JSON.stringify(dels)}`
  );
  assert.ok(
    !dels.some((k) => k.includes('undefined')),
    'no debe quedar ninguna clave con "undefined"'
  );
});
