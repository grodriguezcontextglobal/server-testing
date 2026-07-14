'use strict';

/**
 * check-large-data / update-large-data (mysql/routes/inventory.js) had two
 * problems found during a security review:
 *
 *  - Neither route had ANY auth middleware — any unauthenticated caller could
 *    bulk-read or bulk-write arbitrary item_ids across ANY company.
 *  - Neither query scoped by company_id — even with auth added, a caller from
 *    Company A could pass item_ids belonging to Company B (item_id is a
 *    globally sequential, easily-enumerable int) and read/modify them (IDOR).
 *  - checkLargeData additionally built its query via string interpolation
 *    (`item_ids.map(id => id).join(",")`) with no type validation — a
 *    non-numeric element in item_ids would be injected raw into the SQL.
 *
 * Fix: validateJWT + authorizePermission('inventory', <action>) on the
 * routes (see mysql/routes/inventory.js), and `AND company_id = ?` added to
 * both queries (Node side for checkLargeData, Go worker side for
 * updateLargeData, since that's where the real UPDATE runs).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCheckLargeData, createUpdateLargeData } = require('../mysql/controllers/item');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

// ─── createCheckLargeData (controller, DI) ───────────────────────────────────

test('checkLargeData: 400 si falta company_id (no consulta la DB)', async () => {
  let executeCalls = 0;
  const controller = createCheckLargeData({
    connectionFn: () => ({ execute: async () => { executeCalls++; return [[]]; } }),
  });
  const res = mockRes();

  await controller({ body: { item_ids: [1, 2, 3] } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(executeCalls, 0);
});

test('checkLargeData: 400 si item_ids no es un array no vacío (no consulta la DB)', async () => {
  let executeCalls = 0;
  const controller = createCheckLargeData({
    connectionFn: () => ({ execute: async () => { executeCalls++; return [[]]; } }),
  });
  const res = mockRes();

  await controller({ body: { company_id: 5, item_ids: [] } }, res);
  await controller({ body: { company_id: 5 } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(executeCalls, 0);
});

test('checkLargeData: consulta parametrizada, scoped por company_id — sin interpolar item_ids en el SQL', async () => {
  const calls = [];
  const controller = createCheckLargeData({
    connectionFn: () => ({
      execute: async (sql, params) => { calls.push({ sql, params }); return [[{ item_id: 200308 }]]; },
    }),
  });
  const res = mockRes();

  await controller({ body: { company_id: 5, item_ids: [200308, 200309, '1) UNION SELECT 1--'] } }, res);

  assert.equal(calls.length, 1);
  // El SQL solo debe tener placeholders — ningún valor de item_ids debe aparecer literal en el texto.
  assert.doesNotMatch(calls[0].sql, /UNION|200308/);
  assert.match(calls[0].sql, /WHERE company_id = \? AND item_id IN \(\?,\?,\?\)/);
  assert.deepEqual(calls[0].params, [5, 200308, 200309, '1) UNION SELECT 1--']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
});

test('checkLargeData: 500 si la consulta falla', async () => {
  const controller = createCheckLargeData({
    connectionFn: () => ({ execute: async () => { throw new Error('DB down'); } }),
  });
  const res = mockRes();

  await controller({ body: { company_id: 5, item_ids: [1] } }, res);

  assert.equal(res.statusCode, 500);
});

// ─── createUpdateLargeData (controller, DI) ──────────────────────────────────

function baseUpdateBody(overrides = {}) {
  return {
    company_id: 5,
    item_ids: [200308, 200309, 200310],
    updates: { logistic_status: 'in-transit', warehouse: 0 },
    ...overrides,
  };
}

test('updateLargeData: 400 si falta company_id (no llama al Go worker)', async () => {
  let workerCalls = 0;
  const controller = createUpdateLargeData({
    runGoWorkerFn: async () => { workerCalls++; return { affectedRows: 3 }; },
  });
  const res = mockRes();

  const { company_id, ...body } = baseUpdateBody();
  await controller({ body }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(workerCalls, 0);
});

test('updateLargeData: 400 si item_ids no es un array no vacío (no llama al Go worker)', async () => {
  let workerCalls = 0;
  const controller = createUpdateLargeData({
    runGoWorkerFn: async () => { workerCalls++; return { affectedRows: 3 }; },
  });
  const res = mockRes();

  await controller({ body: baseUpdateBody({ item_ids: [] }) }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(workerCalls, 0);
});

test('updateLargeData: 400 si updates viene vacío/inválido (no llama al Go worker)', async () => {
  let workerCalls = 0;
  const controller = createUpdateLargeData({
    runGoWorkerFn: async () => { workerCalls++; return { affectedRows: 3 }; },
  });
  const res = mockRes();

  await controller({ body: baseUpdateBody({ updates: {} }) }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(workerCalls, 0);
});

test('updateLargeData: 200 y reenvía company_id al Go worker junto con item_ids/updates', async () => {
  const calls = [];
  const controller = createUpdateLargeData({
    runGoWorkerFn: async (command, payload) => { calls.push({ command, payload }); return { affectedRows: 3 }; },
  });
  const res = mockRes();

  await controller({ body: baseUpdateBody() }, res);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'update-item-warehouse');
  assert.deepEqual(calls[0].payload, {
    item_ids: [200308, 200309, 200310],
    updates: { logistic_status: 'in-transit', warehouse: 0 },
    company_id: 5,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.deepEqual(res.payload.result, { affectedRows: 3 });
});

test('updateLargeData: 500 si el Go worker falla', async () => {
  const controller = createUpdateLargeData({
    runGoWorkerFn: async () => { throw new Error('Go Worker Connection Failed'); },
  });
  const res = mockRes();

  await controller({ body: baseUpdateBody() }, res);

  assert.equal(res.statusCode, 500);
});
