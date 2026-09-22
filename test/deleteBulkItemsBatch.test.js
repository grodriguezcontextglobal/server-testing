'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolve = (rel) => path.join(root, rel);
const connPath = resolve('mysql/database/config.js');
const goWorkerPath = resolve('helpers/goWorker.js');
const controllerPath = resolve('mysql/controllers/item.js');
const queuePath = resolve('helpers/queue.js');
const queuedControllerPath = resolve('helpers/queuedController.js');

let poolCalls;
let goWorkerCalls;
let enqueueCalls;

function mockRes() {
  const res = {};
  res.status = (code) => {
    res._code = code;
    return res;
  };
  res.json = (body) => {
    res._body = body;
    return res;
  };
  return res;
}

// role_level 6 => LOCATION_SCOPED_ROLES, permitted at location_id=1 only.
function loadController({ itemRowsByBatch } = {}) {
  delete require.cache[connPath];
  delete require.cache[goWorkerPath];
  delete require.cache[controllerPath];
  delete require.cache[queuePath];
  delete require.cache[queuedControllerPath];

  let scopeSelectCount = 0;
  const pool = {
    execute: async (sql, params) => {
      poolCalls.push({ sql, params });
      if (sql.includes('FROM company_staff cs')) {
        return [[{ company_staff_id: 'staff-1', role_type: 'inventory_location_manager', role_level: 6, location_ids: '1', category_ids: null }]];
      }
      if (sql.includes('FROM staff_location_access')) {
        return [[{ location_id: 1 }]];
      }
      if (sql.includes('SELECT item_id, location_id, category_name FROM item_inv')) {
        const rows = itemRowsByBatch[scopeSelectCount++] || [];
        return [rows];
      }
      return [[]];
    },
    query: async (sql) => {
      if (sql.includes('FROM company_staff cs')) {
        return [[{ company_staff_id: 'staff-1', role_type: 'inventory_location_manager', role_level: 6, location_ids: '1', category_ids: null }]];
      }
      return [[]];
    },
    getConnection: async () => ({ execute: pool.execute, query: pool.query }),
  };

  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => pool,
  };
  require.cache[goWorkerPath] = {
    id: goWorkerPath,
    filename: goWorkerPath,
    loaded: true,
    exports: Object.assign(
      async (command, args) => {
        goWorkerCalls.push({ command, args });
        return { status: 'success', data: { deleted_count: args.item_ids.length } };
      },
      { createRunGoWorker: () => async () => ({ status: 'success', data: {} }) }
    ),
  };

  // El borrado real se fue a queue/handlers/deleteBulkItemsByIds.js: el
  // controller ya no llama al Go worker, encola. Lo que estos tests siguen
  // verificando es el precomputo que NO puede irse al job (el SELECT de scope
  // troceado y el filtrado de ids), ahora observado en el payload del job.
  require.cache[queuePath] = {
    id: queuePath, filename: queuePath, loaded: true,
    exports: {
      enqueue: async (type, payload, opts) => {
        enqueueCalls.push({ type, payload, opts });
        return { id: 'JOB-1' };
      },
      extractJobContext: () => ({ uid: 'U1' }),
    },
  };
  require.cache[queuedControllerPath] = {
    id: queuedControllerPath, filename: queuedControllerPath, loaded: true,
    exports: {
      waitForJobOutcome: async () => ({
        outcome: 'done',
        result: { deletedCount: enqueueCalls.at(-1)?.payload.item_ids.length ?? 0 },
      }),
      createQueuedJobController: () => async () => {},
      createSyncOrQueuedController: () => async () => {},
    },
  };

  return require('../mysql/controllers/item');
}

beforeEach(() => {
  poolCalls = [];
  goWorkerCalls = [];
  enqueueCalls = [];
});

describe('deleteBulkItems scope-filter batching', () => {
  it('batches the scope-filter SELECT for a large item_ids array instead of one unbounded IN(...)', async () => {
    const itemIds = Array.from({ length: 1200 }, (_, i) => i + 1);
    // Every batch's rows report location_id=1, which is the permitted one.
    const itemRowsByBatch = [
      itemIds.slice(0, 500).map((id) => ({ item_id: id, location_id: 1, category_name: 'Laptop' })),
      itemIds.slice(500, 1000).map((id) => ({ item_id: id, location_id: 1, category_name: 'Laptop' })),
      itemIds.slice(1000, 1200).map((id) => ({ item_id: id, location_id: 1, category_name: 'Laptop' })),
    ];
    const { deleteBulkItems } = loadController({ itemRowsByBatch });

    const res = mockRes();
    await deleteBulkItems(
      { body: { item_ids: itemIds, company_id: 137 }, sqlStaffId: 1 },
      res
    );

    const scopeSelects = poolCalls.filter((c) => c.sql.includes('SELECT item_id, location_id, category_name'));
    // 1200 ids / 500-per-batch default => 3 SELECT batches
    assert.equal(scopeSelects.length, 3);
    assert.equal(res._code, 200);
    assert.equal(goWorkerCalls.length, 0, 'el controller ya no llama al Go worker, encola');
    assert.equal(enqueueCalls.length, 1);
    assert.equal(enqueueCalls[0].type, 'inventory:bulk-delete-by-ids');
    assert.equal(enqueueCalls[0].payload.item_ids.length, 1200);
  });

  it('drops non-permitted ids across batches and reports skipped_count', async () => {
    const itemIds = [1, 2, 3, 4];
    const itemRowsByBatch = [
      [
        { item_id: 1, location_id: 1, category_name: 'Laptop' }, // permitted
        { item_id: 2, location_id: 2, category_name: 'Laptop' }, // NOT permitted
        { item_id: 3, location_id: 1, category_name: 'Laptop' }, // permitted
        { item_id: 4, location_id: 2, category_name: 'Laptop' }, // NOT permitted
      ],
    ];
    const { deleteBulkItems } = loadController({ itemRowsByBatch });

    const res = mockRes();
    await deleteBulkItems(
      { body: { item_ids: itemIds, company_id: 137 }, sqlStaffId: 1 },
      res
    );

    assert.equal(res._code, 200);
    assert.equal(res._body.skipped_count, 2);
    assert.deepEqual(enqueueCalls[0].payload.item_ids, [1, 3]);
  });
});
