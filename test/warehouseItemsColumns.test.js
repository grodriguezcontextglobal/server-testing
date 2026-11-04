'use strict';

/**
 * POST /api/db_item/warehouse-items (2026-11-04, SI-10).
 *
 * Las claves del body se usan como nombres de columna en el WHERE. Antes se
 * interpolaban tal cual: una clave como "1=1 OR company_id" leía el
 * inventario de otras compañías. Ahora solo columnas de ITEM_INV_COLUMNS,
 * entre backticks, y valores escalares.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const queries = [];
const configPath = path.resolve(__dirname, '../mysql/database/config.js');
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: () => ({
    execute: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM company_staff')) {
        return [[{ company_staff_id: 1, role_type: 'admin', role_level: 1 }]];
      }
      return [[{ item_id: 1 }]];
    },
  }),
};

const { consultingItemInWarehouseTable } = require('../mysql/controllers/item');

function res() {
  return {
    statusCode: 200,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; },
  };
}
const itemQueries = () => queries.filter((q) => q.sql.includes('FROM item_inv'));

test('lo que manda el dashboard sigue funcionando', async () => {
  queries.length = 0;
  const r = res();
  await consultingItemInWarehouseTable({
    sqlStaffId: 7,
    body: {
      company_id: 5, warehouse: 1, enableAssignFeature: 1,
      category_name: 'Radios', item_group: 'R1', brand: 'B', ownership: 'Rent',
      role: '0', preference: ['loc-a'],
    },
  }, r);
  assert.equal(r.statusCode, 201);
  const [q] = itemQueries();
  assert.match(q.sql, /`company_id`=\? AND `warehouse`=\? AND `enableAssignFeature`=\?/);
  assert.ok(!q.sql.includes('role') && !q.sql.includes('preference'), 'role y preference no van al SQL');
  assert.deepEqual(q.params.slice(0, 3), [5, 1, 1]);
});

test('una clave que no es columna de item_inv: 400 y no se consulta nada', async () => {
  queries.length = 0;
  for (const key of ['1=1 OR company_id', 'company_id`=1 OR `1', 'nope']) {
    const r = res();
    await consultingItemInWarehouseTable({ sqlStaffId: 7, body: { company_id: 5, [key]: 1 } }, r);
    assert.equal(r.statusCode, 400, key);
  }
  assert.equal(queries.length, 0);
});

test('un valor objeto o array: 400', async () => {
  queries.length = 0;
  for (const value of [{ a: 1 }, [1, 2]]) {
    const r = res();
    await consultingItemInWarehouseTable({ sqlStaffId: 7, body: { company_id: 5, brand: value } }, r);
    assert.equal(r.statusCode, 400);
  }
  assert.equal(queries.length, 0);
});
