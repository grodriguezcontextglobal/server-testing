'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildInventoryScopeFilter, applyWorkerScope } = require('../mysql/helpers/staffAccess');

// helpers to build access objects shaped like getStaffCompanyAccess() output
const full = () => ({ role_type: 'admin', role_level: 1, scoped: false, locations: [], categories: [], categoryNames: [] });
const loc = (locations) => ({ role_type: 'inventory_location_manager', role_level: 6, scoped: true, locations, categories: [], categoryNames: [] });
const cat = (categoryNames, categories = categoryNames.map((_, i) => i + 1)) =>
  ({ role_type: 'category_manager', role_level: 8, scoped: true, locations: [], categories, categoryNames });

// ════════════════════════════════════════════════════════════════════════════════
// buildInventoryScopeFilter (SQL sites)
// ════════════════════════════════════════════════════════════════════════════════

test('buildInventoryScopeFilter: full-access → sin restricción', () => {
  assert.deepEqual(buildInventoryScopeFilter(full()), { sql: '', params: [] });
});

test('buildInventoryScopeFilter: rol de locación con locaciones → location IN', () => {
  const r = buildInventoryScopeFilter(loc([3, 7]));
  assert.equal(r.sql, 'location IN (?,?)');
  assert.deepEqual(r.params, [3, 7]);
});

test('buildInventoryScopeFilter: rol de categoría filtra por NOMBRE de categoría', () => {
  const r = buildInventoryScopeFilter(cat(['Audio', 'Video']));
  assert.equal(r.sql, 'category_name IN (?,?)');
  assert.deepEqual(r.params, ['Audio', 'Video']);
});

test('buildInventoryScopeFilter: rol scoped SIN asignaciones → 1=0 (fail-closed)', () => {
  assert.deepEqual(buildInventoryScopeFilter(loc([])), { sql: '1=0', params: [] });
  assert.deepEqual(buildInventoryScopeFilter(cat([])), { sql: '1=0', params: [] });
});

test('buildInventoryScopeFilter: respeta columnas custom (prefijo ii.)', () => {
  const r = buildInventoryScopeFilter(cat(['Cables']), { locationColumn: 'ii.location', categoryColumn: 'ii.category_name' });
  assert.equal(r.sql, 'ii.category_name IN (?)');
  const rl = buildInventoryScopeFilter(loc([5]), { locationColumn: 'ii.location', categoryColumn: 'ii.category_name' });
  assert.equal(rl.sql, 'ii.location IN (?)');
});

test('buildInventoryScopeFilter: null/undefined access → sin restricción', () => {
  assert.deepEqual(buildInventoryScopeFilter(null), { sql: '', params: [] });
});

// ════════════════════════════════════════════════════════════════════════════════
// applyWorkerScope (Go-worker payload sites)
// ════════════════════════════════════════════════════════════════════════════════

test('applyWorkerScope: full-access → payload intacto, denyAll false', () => {
  const { payload, denyAll } = applyWorkerScope(full(), { company_id: 5 });
  assert.deepEqual(payload, { company_id: 5 });
  assert.equal(denyAll, false);
});

test('applyWorkerScope: rol de locación con locaciones → payload.locations', () => {
  const { payload, denyAll } = applyWorkerScope(loc([3, 7]), { company_id: 5 });
  assert.deepEqual(payload.locations, [3, 7]);
  assert.equal(payload.categories, undefined);
  assert.equal(denyAll, false);
});

test('applyWorkerScope: rol de categoría → payload.categories con NOMBRES', () => {
  const { payload, denyAll } = applyWorkerScope(cat(['Audio', 'Video']), { company_id: 5 });
  assert.deepEqual(payload.categories, ['Audio', 'Video']);
  assert.equal(payload.locations, undefined);
  assert.equal(denyAll, false);
});

test('applyWorkerScope: rol scoped SIN asignaciones → denyAll true, payload sin filtro', () => {
  const a = applyWorkerScope(loc([]), { company_id: 5 });
  assert.equal(a.denyAll, true);
  const b = applyWorkerScope(cat([]), { company_id: 5 });
  assert.equal(b.denyAll, true);
});
