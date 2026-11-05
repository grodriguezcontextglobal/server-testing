'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planCleanup } = require('../mysql/scripts/cleanup-dangling-location-refs');

const base = (over = {}) => ({
  access: [{ id: 'a-261', company_staff_id: 'ghost', location_id: 261 }],
  paths: [{ path_id: 16, location_id: 32 }, { path_id: 1, location_id: 100 }],
  subs: [{ sub_location_id: 39, location_id: 32 }, { sub_location_id: 102, location_id: 32 }],
  itemsOnMissingLocation: 0,
  itemsBySub: new Map(),
  ...over,
});

test('caso de prod: borra permisos, rutas y sublocaciones vacías', () => {
  const p = planCleanup(base());
  assert.deepEqual(p.blockers, []);
  assert.deepEqual(p.deleteAccess, ['a-261']);
  assert.deepEqual(p.deletePaths, [16, 1]);
  assert.deepEqual(p.deleteSubs, [39, 102]);
});

test('bloquea si una sublocación a borrar tiene ítems', () => {
  const p = planCleanup(base({ itemsBySub: new Map([[102, 4]]) }));
  assert.equal(p.blockers.length, 1);
  assert.match(p.blockers[0].what, /102/);
});

test('bloquea si hay ítems en una locación inexistente', () => {
  const p = planCleanup(base({ itemsOnMissingLocation: 3 }));
  assert.deepEqual(p.blockers, [{ what: 'item_inv.location_id → locación inexistente', items: 3 }]);
});
