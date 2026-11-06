'use strict';

/**
 * Que cada escritura que añade staff o inventario pase por el tope del plan
 * (2026-11-06; reports/FRONTEND_subscription_plans_update_2026-11-06.md §4.1).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createBulkInsertItemRangeHandler } = require('../queue/handlers/bulkInsertItemRange');
const { createInventoryBulkInsertHandler } = require('../queue/handlers/inventoryBulkInsert');
const { buildRefusal } = require('../helpers/planLimits');

const refusal = buildRefusal({ resource: 'items', plan: 'free', limit: 1000, current: 995, requested: 10 });

const fakePool = () => {
  const calls = { queries: 0 };
  return {
    calls,
    getConnection: () => ({
      getConnection: async () => ({
        beginTransaction: async () => {},
        query: async (sql, [rows]) => {
          calls.queries += 1;
          return [{ affectedRows: rows.length, insertId: 1 }];
        },
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
      }),
    }),
  };
};

describe('handlers de la cola: todo o nada', () => {
  test('rango: con el tope lleno devuelve el rechazo como resultado y no inserta', async () => {
    const pool = fakePool();
    let args;
    const handler = createBulkInsertItemRangeHandler({
      getConnection: pool.getConnection,
      withPlanCapacity: async (a) => {
        args = a;
        return { refusal };
      },
    });
    const out = await handler(
      { company_id: 7, min_serial_number: '001', max_serial_number: '010' },
      { context: { uid: 'u1' } }
    );
    assert.equal(out.code, 'PLAN_LIMIT_REACHED');
    assert.equal(pool.calls.queries, 0);
    assert.equal(args.resource, 'items');
    assert.equal(args.requested, 10);
    assert.equal(args.sqlCompanyId, 7);
    assert.equal(args.context.uid, 'u1');
  });

  test('rango: si cabe, inserta dentro del candado', async () => {
    const pool = fakePool();
    const handler = createBulkInsertItemRangeHandler({
      getConnection: pool.getConnection,
      withPlanCapacity: async (_a, fn) => ({ result: await fn() }),
    });
    const out = await handler({ company_id: 7, min_serial_number: '1', max_serial_number: '3' }, {});
    assert.equal(out.total, 3);
    assert.equal(pool.calls.queries, 1);
  });

  test('alfanumérico: cuenta la lista entera', async () => {
    const pool = fakePool();
    let args;
    const handler = createInventoryBulkInsertHandler({
      getConnection: pool.getConnection,
      withPlanCapacity: async (a) => {
        args = a;
        return { refusal };
      },
    });
    const out = await handler({ company_id: 7, list: ['A', 'B', 'C'] }, {});
    assert.equal(out.code, 'PLAN_LIMIT_REACHED');
    assert.equal(args.requested, 3);
    assert.equal(pool.calls.queries, 0);
  });
});

describe('controladores que encolan: aviso inmediato', () => {
  const { createInsertBulkItemRange, createInsertBulkItemAlphanumeric } = require('../mysql/controllers/item');
  const makeRes = () => {
    const res = { statusCode: 200 };
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (b) => ((res.body = b), res);
    return res;
  };
  const common = {
    getLocationIdFn: async () => 5,
    connectionFn: () => ({}),
    getStaffCompanyAccessFn: async () => ({ fullAccess: true }),
    canWriteInScopeFn: async () => true,
    extractContextFn: () => ({ uid: 'u1' }),
  };

  test('rango: 403 PLAN_LIMIT_REACHED antes de encolar, con las filas pedidas', async () => {
    let enqueued = false;
    let requested;
    const handler = createInsertBulkItemRange({
      ...common,
      enqueueFn: async () => {
        enqueued = true;
      },
      precheckPlanCapacityFn: async (a) => {
        requested = a.requested;
        return refusal;
      },
    });
    const res = makeRes();
    await handler(
      { body: { location: 'L', company_id: 7, min_serial_number: '0001', max_serial_number: '0250' }, sqlStaffId: 1 },
      res
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'PLAN_LIMIT_REACHED');
    assert.equal(requested, 250);
    assert.equal(enqueued, false);
  });

  test('rango: si el job devuelve el rechazo (carrera), responde 403 y no 201', async () => {
    const handler = createInsertBulkItemRange({
      ...common,
      enqueueFn: async () => ({ id: 'j1' }),
      precheckPlanCapacityFn: async () => null,
      waitForJobOutcomeFn: async () => ({ outcome: 'done', result: refusal }),
    });
    const res = makeRes();
    await handler({ body: { location: 'L', company_id: 7, min_serial_number: '1', max_serial_number: '2' } }, res);
    assert.equal(res.statusCode, 403);
  });

  test('alfanumérico: 403 antes de encolar', async () => {
    let enqueued = false;
    const handler = createInsertBulkItemAlphanumeric({
      ...common,
      enqueueFn: async () => {
        enqueued = true;
      },
      precheckPlanCapacityFn: async () => refusal,
    });
    const res = makeRes();
    await handler({ body: { location: 'L', company_id: 7, list: ['A', 'B'] }, get: () => undefined }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(enqueued, false);
  });
});

describe('las demás rutas de alta pasan por el tope (lectura del código)', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  test('POST /api/db_item/new_item y /db_company/insert-new-single-item (insertingItem)', () => {
    const src = read('mysql/controllers/item.js');
    const body = src.slice(src.indexOf('const insertingItem = async'), src.indexOf('function createInsertBulkItemRange'));
    assert.match(body, /withPlanCapacity\(\s*\{ resource: "items"/);
    assert.match(body, /status\(403\)\.json\(capacity\.refusal\)/);
  });

  test('POST /api/db_staff/company-staff y PATCH (reactivar)', () => {
    const src = read('mysql/controllers/staff.js');
    for (const fn of ['const addCompanyStaff', 'const updateCompanyStaff =']) {
      const start = src.indexOf(fn);
      const body = src.slice(start, start + 3000);
      assert.match(body, /withPlanCapacity\(/, fn);
      assert.match(body, /resource: "staff"/, fn);
    }
  });

  test('POST /api/registration/accept-invitation reserva hueco antes de confirmar', () => {
    const src = read('controller/registration.js');
    const body = src.slice(src.indexOf('const acceptInvitation = async'));
    const reserve = body.indexOf('reservePlanCapacity(');
    const confirm = body.indexOf('companyDoc.employees[empIndex].status = "Confirmed"');
    assert.ok(reserve > 0 && reserve < confirm);
    assert.match(body, /finally \{\s*if \(planReservation\) await planReservation\.release\(\);/);
  });

  test('import de hoja de cálculo', () => {
    const src = read('queue/handlers/inventoryImportSpreadsheet.js');
    assert.match(src, /requested: insertable\.length/);
  });
});
