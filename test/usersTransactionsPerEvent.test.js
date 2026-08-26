'use strict';

/**
 * Regresión de rendimiento de GET /api/event/all-users-and-transactions-per-event
 * (controller/auth.js § getListOfUsersAndTransactionsPerEvent).
 *
 * Era un Receivers.find() por CADA usuario del evento, secuencial: 200
 * asistentes = 200 viajes a Mongo esperando uno al otro. Ahora es una sola
 * query con $in y el reparto por usuario se hace en memoria con lodash.groupBy.
 *
 * Los tests fijan además la tabla de `status` que el cliente ya consume, para
 * que la optimización no la altere: 0 sin transacciones, 1 mezcladas, 2 todas
 * activas, 3 todas devueltas.
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

const calls = { receiversFind: [], userFind: [] };

const UserStub = {
  _rows: [],
  find: async (filter) => {
    calls.userFind.push(filter);
    return UserStub._rows;
  },
};

const ReceiversStub = {
  _rows: [],
  find: async (filter) => {
    calls.receiversFind.push(filter);
    const wanted = filter?.user?.$in ?? [];
    return ReceiversStub._rows.filter((r) => wanted.includes(r.user));
  },
};

stub('models/User.js', UserStub);
stub('models/Receivers.js', ReceiversStub);
stub('models/Event.js', {
  findOne: async () => ({ eventInfoDetail: { eventName: 'Expo 2026' } }),
});
stub('helpers/jwt.js', { generateJWT: async () => 'tok' });
stub('database/cacheMemoryConfig.js', { clientRedis: async () => ({ get: async () => null, set: async () => {}, del: async () => {} }) });
stub('helpers/goWorker.js', async () => ({}));
stub('helpers/logger.js', { error: () => {}, warn: () => {}, info: () => {} });

const { getListOfUsersAndTransactionsPerEvent } = require('../controller/auth');

const makeReq = () => ({
  _parsedUrl: { query: 'event_providers=EV1&company_providers=C9' },
});

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

const run = async () => {
  const res = makeRes();
  await getListOfUsersAndTransactionsPerEvent(makeReq(), res);
  return res;
};

const reset = () => {
  calls.receiversFind.length = 0;
  calls.userFind.length = 0;
};

test('una sola query a Receivers con $in de todos los emails, no una por usuario', async () => {
  reset();
  UserStub._rows = [
    { email: 'u1@x.com' },
    { email: 'u2@x.com' },
    { email: 'u3@x.com' },
  ];
  ReceiversStub._rows = [];

  const res = await run();

  assert.equal(res.statusCode, 200);
  assert.equal(calls.receiversFind.length, 1, `esperaba 1 query, hubo ${calls.receiversFind.length}`);
  assert.deepEqual(calls.receiversFind[0], {
    user: { $in: ['u1@x.com', 'u2@x.com', 'u3@x.com'] },
    eventSelected: 'Expo 2026',
    company: 'C9',
  });
});

test('la tabla de status por usuario no cambia con el agrupado en memoria', async () => {
  reset();
  UserStub._rows = [
    { email: 'sin@x.com' },
    { email: 'mixto@x.com' },
    { email: 'activo@x.com' },
    { email: 'devuelto@x.com' },
  ];
  ReceiversStub._rows = [
    { user: 'mixto@x.com', device: { status: true } },
    { user: 'mixto@x.com', device: { status: false } },
    { user: 'activo@x.com', device: { status: true } },
    { user: 'activo@x.com', device: { status: true } },
    { user: 'devuelto@x.com', device: { status: false } },
  ];

  const res = await run();
  const data = JSON.parse(res.body.data);

  assert.deepEqual(
    data.map((row) => [row.user.email, row.transactions]),
    [
      ['sin@x.com', 0],
      ['mixto@x.com', 1],
      ['activo@x.com', 2],
      ['devuelto@x.com', 3],
    ]
  );
});

test('sin usuarios no se consulta Receivers en absoluto', async () => {
  reset();
  UserStub._rows = [];
  ReceiversStub._rows = [{ user: 'otro@x.com', device: { status: true } }];

  const res = await run();

  assert.equal(calls.receiversFind.length, 0);
  assert.deepEqual(JSON.parse(res.body.data), []);
});

test('las transacciones de un usuario no se filtran a otro', async () => {
  reset();
  UserStub._rows = [{ email: 'a@x.com' }, { email: 'b@x.com' }];
  ReceiversStub._rows = [
    { user: 'a@x.com', device: { status: true } },
    { user: 'b@x.com', device: { status: false } },
  ];

  const res = await run();
  const data = JSON.parse(res.body.data);

  assert.equal(data[0].transactions, 2, 'a@x.com tiene solo activas');
  assert.equal(data[1].transactions, 3, 'b@x.com tiene solo devueltas');
});

test('emails duplicados en la lista de usuarios no duplican el $in', async () => {
  reset();
  UserStub._rows = [{ email: 'a@x.com' }, { email: 'a@x.com' }];
  ReceiversStub._rows = [{ user: 'a@x.com', device: { status: true } }];

  const res = await run();

  assert.deepEqual(calls.receiversFind[0].user, { $in: ['a@x.com'] });
  // pero las dos filas de usuario siguen saliendo, con el mismo status
  const data = JSON.parse(res.body.data);
  assert.deepEqual(data.map((r) => r.transactions), [2, 2]);
});
