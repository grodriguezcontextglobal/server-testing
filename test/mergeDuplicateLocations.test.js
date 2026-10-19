'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planMerge } = require('../mysql/scripts/merge-duplicate-locations');

// Lo que se vio en prod el 2026-10-16, reducido.
const locations = [
  { location_id: 31, company_id: 136, location_name: 'Washington, DC' },
  { location_id: 253, company_id: 136, location_name: 'Washington, DC' },
  { location_id: 33, company_id: 129, location_name: 'Fort Lauderdale, Fl' },
  { location_id: 255, company_id: 129, location_name: 'Fort Lauderdale, Fl' },
  { location_id: 55, company_id: 143, location_name: '7 Grade' },
  { location_id: 266, company_id: 143, location_name: '7 Grade' },
  { location_id: 26, company_id: 133, location_name: 'Washington, DC' },
];
const refs = (pairs) => new Map(pairs);
const base = (over = {}) => ({
  locations,
  refsByTable: {
    item_inv: refs([[31, 380], [33, 45], [55, 20], [26, 54]]),
    staff_location_access: refs([[253, 2], [255, 1], [266, 1]]),
  },
  access: [
    { id: 'a1', company_staff_id: 'cs-fstar-136', location_id: 253 },   // misma compañía → repuntar
    { id: 'a2', company_staff_id: 'cs-caca-133', location_id: 253 },    // otra compañía → borrar
    { id: 'a3', company_staff_id: 'cs-caca-133', location_id: 255 },    // otra compañía → borrar
    { id: 'a4', company_staff_id: 'cs-ghost', location_id: 266 },       // huérfana → borrar
  ],
  companyOfStaff: new Map([['cs-fstar-136', 136], ['cs-caca-133', 133], ['cs-jdow1-143', 143]]),
  ...over,
});

test('plan de prod: repunta la de la misma compañía y borra huérfanas y de otra compañía', () => {
  const p = planMerge(base());
  assert.deepEqual(p.blockers, []);
  assert.deepEqual(p.accessRepoints.map((a) => [a.id, a.location_id, a.to]), [['a1', 253, 31]]);
  assert.deepEqual(
    Object.fromEntries(p.accessDeletes.map((a) => [a.id, a.reason])),
    { a2: 'other_company_location', a3: 'other_company_location', a4: 'orphan_company_staff' },
  );
  assert.deepEqual(p.locationDeletes.sort((a, b) => a - b), [253, 255, 266]);
});

test('si la canónica ya está asignada a ese empleado, la copia se borra en vez de duplicar', () => {
  const input = base();
  input.access = [
    { id: 'keep', company_staff_id: 'cs-fstar-136', location_id: 31 },
    { id: 'dup', company_staff_id: 'cs-fstar-136', location_id: 253 },
  ];
  const p = planMerge(input);
  assert.deepEqual(p.accessRepoints, []);
  assert.deepEqual(p.accessDeletes.map((a) => [a.id, a.reason]), [['dup', 'canonical_already_assigned']]);
});

test('bloquea si cualquier otra tabla apunta a una copia (los datos cambiaron desde el diagnóstico)', () => {
  const input = base();
  input.refsByTable.item_inv = refs([[31, 380], [253, 3]]);
  const p = planMerge(input);
  assert.deepEqual(p.blockers, [{ table: 'item_inv', rows: 3 }]);
});

test('la copia más referenciada es la que se queda, aunque tenga el id más alto', () => {
  const input = base();
  input.refsByTable.item_inv = refs([[253, 500]]);
  input.access = [];
  const p = planMerge(input);
  assert.equal(p.groups.find((g) => g.company_id === 136).canonical, 253);
  assert.ok(p.locationDeletes.includes(31));
});

test('sin duplicados: plan vacío', () => {
  const p = planMerge({ locations: [locations[0], locations[2]], refsByTable: {}, access: [], companyOfStaff: new Map() });
  assert.deepEqual([p.groups.length, p.locationDeletes.length, p.accessDeletes.length], [0, 0, 0]);
});
