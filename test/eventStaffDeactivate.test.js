'use strict';

/**
 * Lote 4 (2026-11-04, AC-2 / AC-6).
 *
 *   - POST /api/company/event-staff/deactivate: el servidor decide quién pierde
 *     el acceso al cerrar un evento (antes el dashboard mandaba el array
 *     entero de employees a update-company).
 *   - POST/PATCH /api/db_staff/company-staff y /company-staff/role exigen
 *     staff:create / staff:update: antes bastaba una sesión de cualquier
 *     compañía para darse de alta como root_admin en otra.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { effectiveChain } = require('./helpers/effectiveChain');
const { createDeactivateEventStaff, losesAccess } = require('../controller/eventStaffAccess');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const EVENT = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER_EVENT = 'cccccccccccccccccccccccc';

function setup({ event, otherEvents = [], employees, sqlAllowed = true, sqlFails = false } = {}) {
  const calls = { companyUpdates: [], sql: [] };
  const lean = (v) => ({ lean: async () => v });
  const deps = {
    Event: () => ({
      findById: (id) => lean(id === EVENT ? event : null),
      find: () => lean(otherEvents),
    }),
    Company: () => ({
      findById: () => lean({ _id: COMPANY, employees }),
      updateOne: async (filter, update, opts) => { calls.companyUpdates.push({ filter, update, opts }); },
    }),
    getConnection: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql, params });
        if (sqlFails) throw new Error('db down');
        if (sql.includes('role_permissions')) return [sqlAllowed ? [{ 1: 1 }] : []];
        return [{ affectedRows: params[1].length }];
      },
    }),
    resolveCompanyContext: (req) => req.headers['x-company-id'] ?? null,
    logger: { warn() {}, error() {} },
  };
  return { handler: createDeactivateEventStaff(deps), calls };
}

const req = (body, headers = { 'x-company-id': COMPANY }) => ({ body, headers, sqlStaffId: 7 });
function res() {
  return {
    code: 200, body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const EMPLOYEES = [
  { user: 'admin@x.com', roleType: 'admin', active: true },
  { user: 'em@x.com', roleType: 'event_manager', active: true },
  { user: 'inv@x.com', roleType: 'inventory_manager', active: true },
  { user: 'asis@x.com', roleType: 'assistant', active: true },
  { user: 'loc@x.com', roleType: 'inventory_location_manager', active: true },
  { user: 'old@x.com', role: '5', active: true },
  { user: 'su@x.com', roleType: 'assistant', super_user: true, active: true },
  { user: 'off@x.com', roleType: 'assistant', active: false },
  { user: 'busy@x.com', roleType: 'assistant', active: true },
  { user: 'notinevent@x.com', roleType: 'assistant', active: true },
];
const ENDED_EVENT = {
  _id: EVENT, company_id: COMPANY, active: false,
  staff: {
    adminUser: [{ email: 'admin@x.com' }, { email: 'em@x.com' }],
    headsetAttendees: ['Inv@x.com', { email: 'asis@x.com' }, { email: 'loc@x.com' }, { email: 'old@x.com' },
      { email: 'su@x.com' }, { email: 'off@x.com' }, { email: 'busy@x.com' }],
  },
};
const BUSY = [{ _id: OTHER_EVENT, staff: { headsetAttendees: [{ email: 'busy@x.com' }] } }];

test('regla: inventory_manager, assistant y el número 4/5 pierden; super_user e inactivos no', () => {
  assert.equal(losesAccess({ roleType: 'assistant', active: true }), true);
  assert.equal(losesAccess({ roleType: 'inventory_manager' }), true);
  assert.equal(losesAccess({ role: '4' }), true);
  assert.equal(losesAccess({ roleType: 'event_manager', role: '5' }), false, 'manda roleType');
  assert.equal(losesAccess({ roleType: 'category_assistant' }), false);
  assert.equal(losesAccess({ roleType: 'assistant', super_user: true }), false);
  assert.equal(losesAccess({ roleType: 'assistant', active: false }), false);
});

test('desactiva solo al staff del evento que pierde acceso, y no al que sigue en otro evento activo', async () => {
  const { handler, calls } = setup({ event: ENDED_EVENT, otherEvents: BUSY, employees: EMPLOYEES });
  const r = res();
  await handler(req({ eventId: EVENT }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.deactivated, ['inv@x.com', 'asis@x.com', 'old@x.com']);
  assert.deepEqual(r.body.keptInOtherEvents, ['busy@x.com']);
  assert.deepEqual(r.body.sql, { skipped: 'no_sql_company' });
  const [u] = calls.companyUpdates;
  assert.deepEqual(u.update, { $set: { 'employees.$[e].active': false } });
  assert.deepEqual(u.opts.arrayFilters[0]['e.user'], { $in: ['inv@x.com', 'asis@x.com', 'old@x.com'] });
  assert.deepEqual(u.opts.arrayFilters[0]['e.super_user'], { $ne: true });
});

test('con sqlCompanyId y permiso event:update en SQL, desactiva también en company_staff', async () => {
  const { handler, calls } = setup({ event: ENDED_EVENT, employees: EMPLOYEES });
  const r = res();
  await handler(req({ eventId: EVENT, sqlCompanyId: 12 }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.sql.updated, 4);
  const update = calls.sql.find((q) => q.sql.includes('UPDATE company_staff'));
  assert.match(update.sql, /role_type IN \('inventory_manager', 'assistant'\)/);
  assert.equal(update.params[0], 12);
  const check = calls.sql.find((q) => q.sql.includes('role_permissions'));
  assert.deepEqual(check.params, [12, 7]);
});

test('sin permiso en la compañía SQL, o con SQL caído: Mongo sí, SQL no', async () => {
  for (const [opts, reason] of [[{ sqlAllowed: false }, 'forbidden'], [{ sqlFails: true }, 'sql_error']]) {
    const { handler, calls } = setup({ event: ENDED_EVENT, employees: EMPLOYEES, ...opts });
    const r = res();
    await handler(req({ eventId: EVENT, sqlCompanyId: 12 }), r);
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.sql, { skipped: reason });
    assert.ok(!calls.sql.some((q) => q.sql.includes('UPDATE company_staff')));
    assert.equal(calls.companyUpdates.length, 1);
  }
});

test('evento en curso: 409 y no toca nada', async () => {
  const { handler, calls } = setup({ event: { ...ENDED_EVENT, active: true }, employees: EMPLOYEES });
  const r = res();
  await handler(req({ eventId: EVENT, sqlCompanyId: 12 }), r);
  assert.equal(r.code, 409);
  assert.equal(calls.companyUpdates.length + calls.sql.length, 0);
});

test('evento de otra compañía o inexistente: 404', async () => {
  const { handler, calls } = setup({ event: { ...ENDED_EVENT, company_id: 'dddddddddddddddddddddddd' }, employees: EMPLOYEES });
  const r = res();
  await handler(req({ eventId: EVENT }), r);
  assert.equal(r.code, 404);
  const r2 = res();
  await handler(req({ eventId: OTHER_EVENT }), r2);
  assert.equal(r2.code, 404);
  assert.equal(calls.companyUpdates.length, 0);
});

test('sin eventId válido o sin compañía: 400', async () => {
  const { handler } = setup({ event: ENDED_EVENT, employees: EMPLOYEES });
  for (const [body, headers] of [[{}, undefined], [{ eventId: { $ne: null } }, undefined], [{ eventId: EVENT }, {}]]) {
    const r = res();
    await handler(req(body, headers), r);
    assert.equal(r.code, 400);
  }
});

test('nadie que desactivar: 200 sin escribir', async () => {
  const { handler, calls } = setup({ event: { ...ENDED_EVENT, staff: { adminUser: [{ email: 'admin@x.com' }] } }, employees: EMPLOYEES });
  const r = res();
  await handler(req({ eventId: EVENT, sqlCompanyId: 12 }), r);
  assert.deepEqual(r.body.deactivated, []);
  assert.deepEqual(r.body.sql, { updated: 0 });
  assert.equal(calls.companyUpdates.length, 0);
});

// ── rutas ────────────────────────────────────────────────────────────────────

const load = (rel) => require(path.resolve(__dirname, rel));
const AUTHZ_SIGNATURE = 'insufficient permissions';
const names = (chain) => chain.map((fn) => fn.name);

test('event-staff/deactivate exige sesión y permiso de Mongo (event:update)', () => {
  const chain = effectiveChain(load('../routes/company'), 'POST', '/event-staff/deactivate');
  assert.ok(chain, 'la ruta existe');
  assert.ok(names(chain).includes('validateJWT'));
  assert.ok(chain.some((fn) => fn.toString().includes(AUTHZ_SIGNATURE)), 'lleva authorizeMongoPermission');
});

test('company-staff: las tres escrituras exigen authorizePermission', () => {
  const router = load('../mysql/routes/staff');
  for (const [method, p] of [['POST', '/company-staff'], ['PATCH', '/company-staff'], ['PATCH', '/company-staff/role']]) {
    const chain = effectiveChain(router, method, p);
    assert.ok(chain.some((fn) => fn.toString().includes(AUTHZ_SIGNATURE)), `${method} ${p}`);
  }
});
