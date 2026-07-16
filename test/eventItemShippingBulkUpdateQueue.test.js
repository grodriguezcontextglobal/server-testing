'use strict';

/**
 * bulkUpdateEventItemShipping (mysql/controllers/items_events.js) hacía el
 * UPDATE masivo de forma síncrona dentro del ciclo request/response. Se migra
 * al patrón genérico de la cola (createQueuedJobController): el controller
 * solo valida (resolveEventItemShippingUpdatePlan, sin DB) y encola; el
 * UPDATE real vive en queue/handlers/eventItemShippingBulkUpdate.js dentro de
 * una única transacción con conexión dedicada del pool.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEventItemShippingBulkUpdateHandler,
  resolveEventItemShippingUpdatePlan,
} = require('../queue/handlers/eventItemShippingBulkUpdate');

function makeTrackedConnection(queryImpl) {
  const calls = { query: [], beginTransaction: 0, commit: 0, rollback: 0, release: 0 };
  const conn = {
    calls,
    query: async (sql, params) => {
      calls.query.push({ sql: sql.trim(), params });
      return queryImpl(sql.trim(), params, calls.query.length);
    },
    beginTransaction: async () => { calls.beginTransaction++; },
    commit: async () => { calls.commit++; },
    rollback: async () => { calls.rollback++; },
    release: () => { calls.release++; },
  };
  return conn;
}

// ─── resolveEventItemShippingUpdatePlan (pure) ────────────────────────────────

test('resolveEventItemShippingUpdatePlan: 400 si falta company_id o event_id', () => {
  const plan = resolveEventItemShippingUpdatePlan({ event_id: 1, updates: { active: true }, filters: { active: false } });
  assert.equal(plan.error.status, 400);
  assert.match(plan.error.msg, /company_id and event_id are required/);
});

test('resolveEventItemShippingUpdatePlan: 400 si updates está vacío', () => {
  const plan = resolveEventItemShippingUpdatePlan({ company_id: 5, event_id: 1, updates: {}, filters: { active: false } });
  assert.equal(plan.error.status, 400);
  assert.match(plan.error.msg, /At least one update field/);
});

test('resolveEventItemShippingUpdatePlan: 400 si filters está vacío', () => {
  const plan = resolveEventItemShippingUpdatePlan({ company_id: 5, event_id: 1, updates: { active: true }, filters: {} });
  assert.equal(plan.error.status, 400);
  assert.match(plan.error.msg, /At least one filter condition/);
});

test('resolveEventItemShippingUpdatePlan: 400 si ningún campo de updates/filters es permitido', () => {
  const badUpdates = resolveEventItemShippingUpdatePlan({ company_id: 5, event_id: 1, updates: { unknown: 1 }, filters: { active: false } });
  assert.match(badUpdates.error.msg, /No valid fields to update/);

  const badFilters = resolveEventItemShippingUpdatePlan({ company_id: 5, event_id: 1, updates: { active: true }, filters: { unknown: 1 } });
  assert.match(badFilters.error.msg, /No valid filter fields provided/);
});

test('resolveEventItemShippingUpdatePlan: plan válido filtra solo los campos permitidos', () => {
  const plan = resolveEventItemShippingUpdatePlan({
    company_id: 5,
    event_id: 1,
    updates: { shipping_status: 'shipped', unknown: 'x' },
    filters: { active: true, unknown: 'y' },
  });
  assert.deepEqual(plan.fieldsToUpdate, ['shipping_status']);
  assert.deepEqual(plan.filterKeys, ['active']);
});

// ─── createEventItemShippingBulkUpdateHandler ─────────────────────────────────

test('handler: ejecuta un UPDATE dentro de una transacción y devuelve updated_count', async () => {
  const conn = makeTrackedConnection(async () => [{ affectedRows: 3 }]);
  const pool = { getConnection: async () => conn };
  const handler = createEventItemShippingBulkUpdateHandler({ getConnection: () => pool });

  const result = await handler({
    company_id: 5,
    event_id: 1,
    updates: { shipping_status: 'shipped' },
    filters: { active: true },
  });

  assert.equal(conn.calls.beginTransaction, 1);
  assert.equal(conn.calls.commit, 1);
  assert.equal(conn.calls.rollback, 0);
  assert.equal(conn.calls.release, 1);
  assert.equal(conn.calls.query.length, 1);
  assert.match(conn.calls.query[0].sql, /UPDATE event_item_shipping SET shipping_status = \?/);
  assert.match(conn.calls.query[0].sql, /WHERE event_id = \? AND company_id = \? AND active = \?/);
  assert.deepEqual(conn.calls.query[0].params, ['shipped', 1, 5, true]);
  assert.equal(result.updated_count, 3);
});

test('handler: hace rollback y relanza el error si el UPDATE falla', async () => {
  const conn = makeTrackedConnection(async () => { throw new Error('DB down'); });
  const pool = { getConnection: async () => conn };
  const handler = createEventItemShippingBulkUpdateHandler({ getConnection: () => pool });

  await assert.rejects(
    () => handler({ company_id: 5, event_id: 1, updates: { active: false }, filters: { active: true } }),
    /DB down/,
  );
  assert.equal(conn.calls.rollback, 1);
  assert.equal(conn.calls.commit, 0);
  assert.equal(conn.calls.release, 1);
});

test('handler: payload inválido (sin controller de por medio) lanza en vez de ejecutar query', async () => {
  let getConnectionCalls = 0;
  const pool = { getConnection: async () => { getConnectionCalls++; return makeTrackedConnection(async () => [{ affectedRows: 0 }]); } };
  const handler = createEventItemShippingBulkUpdateHandler({ getConnection: () => pool });

  await assert.rejects(() => handler({ event_id: 1, updates: { active: true }, filters: { active: false } }), /company_id and event_id are required/);
  assert.equal(getConnectionCalls, 0, 'no debe pedir conexión si el payload es inválido');
});
