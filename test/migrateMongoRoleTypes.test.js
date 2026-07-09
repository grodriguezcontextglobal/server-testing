'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Importamos solo la lógica pura (sin mongoose) para poder testear sin DB.
// AdminUser.role NO se migra — es dato de registro inicial, no fuente de verdad.
// La fuente de verdad del rol es Company.employees[].role (numérico "0"-"5").
const {
  mapNumericRoleToRoleType,
  buildEmployeeUpdate,
} = require('../scripts/migrateMongoRoleTypes');

// ─── mapNumericRoleToRoleType: "0"-"5" → role_type canónico ──────────────────

test('mapNumericRoleToRoleType: "0" → root_admin', () => {
  assert.equal(mapNumericRoleToRoleType('0'), 'root_admin');
});

test('mapNumericRoleToRoleType: "1" → admin', () => {
  assert.equal(mapNumericRoleToRoleType('1'), 'admin');
});

test('mapNumericRoleToRoleType: "2" → sale_manager', () => {
  assert.equal(mapNumericRoleToRoleType('2'), 'sale_manager');
});

test('mapNumericRoleToRoleType: "3" → event_manager', () => {
  assert.equal(mapNumericRoleToRoleType('3'), 'event_manager');
});

test('mapNumericRoleToRoleType: "4" → inventory_manager', () => {
  assert.equal(mapNumericRoleToRoleType('4'), 'inventory_manager');
});

test('mapNumericRoleToRoleType: "5" → assistant', () => {
  assert.equal(mapNumericRoleToRoleType('5'), 'assistant');
});

test('mapNumericRoleToRoleType: valor desconocido → null', () => {
  assert.equal(mapNumericRoleToRoleType('9'), null);
});

test('mapNumericRoleToRoleType: null → null', () => {
  assert.equal(mapNumericRoleToRoleType(null), null);
});

// ─── buildEmployeeUpdate: genera paths para Company.employees ─────────────────

test('buildEmployeeUpdate: genera path cuando roleType es undefined', () => {
  const emp = { role: '3', roleType: undefined };
  const result = buildEmployeeUpdate(emp, 0);
  assert.ok(result !== null);
  assert.equal(result.path, 'employees.0.roleType');
  assert.equal(result.value, 'event_manager');
});

test('buildEmployeeUpdate: genera path cuando roleType es null', () => {
  const emp = { role: '2', roleType: null };
  const result = buildEmployeeUpdate(emp, 1);
  assert.ok(result !== null);
  assert.equal(result.path, 'employees.1.roleType');
  assert.equal(result.value, 'sale_manager');
});

test('buildEmployeeUpdate: retorna null si roleType ya está establecido', () => {
  const emp = { role: '1', roleType: 'event_manager' };
  const result = buildEmployeeUpdate(emp, 0);
  assert.equal(result, null);
});

test('buildEmployeeUpdate: retorna null si role no tiene mapeo', () => {
  const emp = { role: '9', roleType: null };
  const result = buildEmployeeUpdate(emp, 0);
  assert.equal(result, null);
});
