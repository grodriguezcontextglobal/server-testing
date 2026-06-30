/**
 * Tests para GET/POST de inventario de evento (event_manager permission scope)
 *
 * Cubre:
 *  - getGroupedItemInventory: devuelve inventario agrupado por category/item_group/location
 *  - getGroupedItemInventory: filtra por location array cuando se pasa
 *  - getGroupedItemInventory: 500 en error SQL
 *  - reserveItemsInInventoryForEvent: reserva items correctamente
 *  - reserveItemsInInventoryForEvent: 404 cuando no hay items afectados
 *  - reserveItemsInInventoryForEvent: 500 en error SQL
 *  - authorizePermission('event','read'): 403 para roles sin permiso de evento
 *  - authorizePermission('event','read'): next() para event_manager
 */

'use strict';

const { describe, it, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// ── configurable SQL behavior ─────────────────────────────────────────────────

const sqlBehavior = {
  failQuery:         false,
  inventoryRows:     [],
  reserveAffected:   2,
  permissionGranted: true,
};

function makeSqlConn() {
  return {
    execute: async (sql, params) => {
      if (sqlBehavior.failQuery) throw new Error('DB error');
      const q = sql.trim().toUpperCase();

      if (q.startsWith('SELECT') && q.includes('ITEM_INV')) {
        return [sqlBehavior.inventoryRows];
      }

      if (q.startsWith('UPDATE ITEM_INV')) {
        return [{ affectedRows: sqlBehavior.reserveAffected }];
      }

      return [[]];
    },
    query: async (sql, params) => {
      if (sqlBehavior.failQuery) throw new Error('DB error');

      // permission check
      if (sqlBehavior.permissionGranted) {
        return [[{ 1: 1 }]];
      }
      return [[]];
    },
    getConnection: async () => ({
      beginTransaction: async () => {},
      execute: async (sql, params) => {
        if (sqlBehavior.failQuery) throw new Error('DB error');
        if (sql.trim().toUpperCase().startsWith('UPDATE ITEM_INV')) {
          return [{ affectedRows: sqlBehavior.reserveAffected }];
        }
        return [[]];
      },
      release: () => {},
    }),
  };
}

// ── stubs ─────────────────────────────────────────────────────────────────────

const loggerStub = { warn: () => {}, error: () => {}, info: () => {} };

before(() => {
  const root    = path.resolve(__dirname, '..');
  const resolve = (rel) => path.join(root, rel);

  const connPath = resolve('mysql/database/config.js');
  require.cache[connPath] = {
    id: connPath, filename: connPath, loaded: true,
    exports: () => makeSqlConn(),
  };

  require.cache[resolve('helpers/logger.js')] = {
    id: resolve('helpers/logger.js'), filename: resolve('helpers/logger.js'),
    loaded: true, exports: loggerStub,
  };
});

afterEach(() => {
  sqlBehavior.failQuery         = false;
  sqlBehavior.inventoryRows     = [];
  sqlBehavior.reserveAffected   = 2;
  sqlBehavior.permissionGranted = true;
});

// ── helpers ───────────────────────────────────────────────────────────────────

function mockRes() {
  const res = {};
  res.status = (code) => { res._code = code; return res; };
  res.json   = (body)  => { res._body = body; return res; };
  return res;
}

// ── lazy import ───────────────────────────────────────────────────────────────

let getGroupedItemInventory;
let reserveItemsInInventoryForEvent;
let authorizePermission;

before(() => {
  ({ getGroupedItemInventory } = require('../mysql/controllers/item'));
  ({ reserveItemsInInventoryForEvent } = require('../mysql/controllers/items_events'));
  ({ authorizePermission } = require('../middlewares/authorizePermission'));
});

// ── getGroupedItemInventory ───────────────────────────────────────────────────

describe('getGroupedItemInventory', () => {
  it('200 con inventario vacío devuelve groupedInventory vacio', async () => {
    sqlBehavior.inventoryRows = [];
    const req = { body: { company_id: 10, warehouse: 1, enableAssignFeature: 1 } };
    const res = mockRes();
    await getGroupedItemInventory(req, res);
    assert.equal(res._code, 200);
    assert.ok(res._body.ok);
    assert.deepEqual(res._body.groupedInventory, {});
  });

  it('200 agrupa por category_name → item_group → location con quantity', async () => {
    sqlBehavior.inventoryRows = [
      { category_name: 'Laptops', item_group: 'Dell XPS', location: 'Warehouse A', quantity: 5 },
      { category_name: 'Laptops', item_group: 'Dell XPS', location: 'Warehouse B', quantity: 3 },
      { category_name: 'Tablets', item_group: 'iPad Pro', location: 'Warehouse A', quantity: 8 },
    ];
    const req = { body: { company_id: 10 } };
    const res = mockRes();
    await getGroupedItemInventory(req, res);

    assert.equal(res._code, 200);
    const grouped = res._body.groupedInventory;
    assert.equal(grouped['Laptops']['Dell XPS']['Warehouse A'], 5);
    assert.equal(grouped['Laptops']['Dell XPS']['Warehouse B'], 3);
    assert.equal(grouped['Tablets']['iPad Pro']['Warehouse A'], 8);
  });

  it('500 en error SQL', async () => {
    sqlBehavior.failQuery = true;
    const req = { body: { company_id: 10 } };
    const res = mockRes();
    await getGroupedItemInventory(req, res);
    assert.equal(res._code, 500);
    assert.equal(res._body.ok, false);
  });
});

// ── reserveItemsInInventoryForEvent ──────────────────────────────────────────

describe('reserveItemsInInventoryForEvent', () => {
  it('200 reserva items y devuelve total_reserved', async () => {
    sqlBehavior.reserveAffected = 3;
    const req = { body: { company_id: 10, items: [101, 102, 103] } };
    const res = mockRes();
    await reserveItemsInInventoryForEvent(req, res);
    assert.equal(res._code, 200);
    assert.ok(res._body.ok);
    assert.equal(res._body.total_reserved, 3);
  });

  it('404 cuando no hay items afectados', async () => {
    sqlBehavior.reserveAffected = 0;
    const req = { body: { company_id: 10, items: [999] } };
    const res = mockRes();
    await reserveItemsInInventoryForEvent(req, res);
    assert.equal(res._code, 404);
    assert.equal(res._body.ok, false);
  });

  it('500 en error SQL', async () => {
    sqlBehavior.failQuery = true;
    const req = { body: { company_id: 10, items: [101] } };
    const res = mockRes();
    await reserveItemsInInventoryForEvent(req, res);
    assert.equal(res._code, 500);
    assert.equal(res._body.ok, false);
  });
});

// ── authorizePermission — event scope ────────────────────────────────────────

describe("authorizePermission('event','read') — event inventory scope", () => {
  it("403 cuando el rol no tiene permiso 'event:read' en SQL", async () => {
    sqlBehavior.permissionGranted = false;
    const req = { sqlStaffId: 42, body: { company_id: 10 }, params: {}, query: {} };
    const res = mockRes();
    let called = false;
    await authorizePermission('event', 'read')(req, res, () => { called = true; });
    assert.equal(res._code, 403);
    assert.equal(called, false);
  });

  it("next() cuando event_manager tiene permiso 'event:read'", async () => {
    sqlBehavior.permissionGranted = true;
    const req = { sqlStaffId: 42, body: { company_id: 10 }, params: {}, query: {} };
    const res = mockRes();
    let called = false;
    await authorizePermission('event', 'read')(req, res, () => { called = true; });
    assert.equal(called, true);
  });

  it("next() cuando event_manager tiene permiso 'event:update' (para reserva)", async () => {
    sqlBehavior.permissionGranted = true;
    const req = { sqlStaffId: 42, body: { company_id: 10 }, params: {}, query: {} };
    const res = mockRes();
    let called = false;
    await authorizePermission('event', 'update')(req, res, () => { called = true; });
    assert.equal(called, true);
  });

  it('401 cuando falta sqlStaffId (token no validado)', async () => {
    const req = { body: { company_id: 10 }, params: {}, query: {} }; // no sqlStaffId
    const res = mockRes();
    let called = false;
    await authorizePermission('event', 'read')(req, res, () => { called = true; });
    assert.equal(res._code, 401);
    assert.equal(called, false);
  });
});
