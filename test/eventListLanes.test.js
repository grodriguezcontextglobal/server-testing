'use strict';

/**
 * POST /api/event/event-list (FedRAMP P1.1, 2026-10-21): dos carriles.
 *   - sesión de staff: el body pasa entero, como siempre;
 *   - dashboard sin sesión: 401;
 *   - anónimo (la app del consumidor): solo { _id } con un ObjectId válido.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let staffSession = false;
const filename = path.join(path.resolve(__dirname, '..'), 'helpers/consumerUserFilter.js');
require.cache[filename] = {
  id: filename, filename, loaded: true,
  exports: {
    isStaffSession: async () => staffSession,
    isStaffOrigin: (req) => req.headers?.origin === 'https://admin.devitrak.net',
  },
};

const router = require('../routes/event');
const lanes = router.stack
  .find((l) => l.route?.path === '/event-list' && l.route.methods.post)
  .route.stack.find((l) => l.handle.name === 'eventListLanes').handle;

async function run(body, headers = {}) {
  const req = { body, headers, header: (n) => headers[n.toLowerCase()] };
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  await lanes(req, res, () => { passed = true; });
  return { req, res, passed };
}

const ID = '6ad8dd4b5fcbd00144d97993';

test('anónimo: solo el _id del evento pasa; el resto del body se descarta', async () => {
  staffSession = false;
  const { req, passed } = await run({ _id: ID, company: { $ne: null } });
  assert.ok(passed);
  assert.deepEqual(req.body, { _id: ID });
});

test('anónimo sin _id, con un _id inválido o con operadores: 400', async () => {
  staffSession = false;
  for (const body of [{}, { _id: 'nope' }, { _id: { $ne: null } }, { active: true }]) {
    const { res, passed } = await run(body);
    assert.equal(passed, false, JSON.stringify(body));
    assert.equal(res.code, 400);
  }
});

test('dashboard sin sesión: 401', async () => {
  staffSession = false;
  const { res, passed } = await run({ _id: ID }, { origin: 'https://admin.devitrak.net' });
  assert.equal(passed, false);
  assert.equal(res.code, 401);
});

test('con sesión de staff el body pasa entero (Login.jsx filtra por staff y active)', async () => {
  staffSession = true;
  const body = { 'staff.headsetAttendees.email': 'a@x.com', active: true };
  const { req, passed } = await run(body, { origin: 'https://admin.devitrak.net' });
  assert.ok(passed);
  assert.equal(req.body, body);
});
