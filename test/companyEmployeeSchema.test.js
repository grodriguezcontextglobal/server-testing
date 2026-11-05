'use strict';

/**
 * Company.employees[] (2026-11-04, S1.3).
 *
 *   - `role` (número heredado) es opcional: el dashboard puede escribir solo
 *     roleType sin que accept-invitation u otro save() falle la validación.
 *   - El enum de roleType es la lista canónica de 10 tipos, la misma de SQL y
 *     de rolePermissions. Antes faltaban los dos de categoría.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Company = require('../models/Company');
const { VALID_ROLE_TYPES_LIST } = require('../mysql/constants/roles');
const { ROLE_PERMISSIONS } = require('../constants/rolePermissions');

const employeeErrors = (employee) => {
  const err = new Company({ employees: [employee] }).validateSync();
  return Object.keys(err?.errors ?? {}).filter((k) => k.startsWith('employees'));
};
const base = { user: 'a@x.com', firstName: 'A', lastName: 'B', super_user: false };

test('un empleado solo con roleType, sin role, es válido', () => {
  assert.deepEqual(employeeErrors({ ...base, roleType: 'assistant' }), []);
});

test('los 10 roleType valen, incluidos los de categoría', () => {
  for (const roleType of VALID_ROLE_TYPES_LIST) {
    assert.deepEqual(employeeErrors({ ...base, roleType }), [], roleType);
  }
  assert.ok(VALID_ROLE_TYPES_LIST.includes('category_manager'));
  assert.ok(VALID_ROLE_TYPES_LIST.includes('category_assistant'));
});

test('un roleType inventado sigue siendo inválido', () => {
  assert.deepEqual(employeeErrors({ ...base, roleType: 'super_admin' }), ['employees.0.roleType']);
});

test('el enum del esquema es la misma lista que los permisos', () => {
  const schemaEnum = Company.schema.path('employees').schema.path('roleType').enumValues;
  assert.deepEqual([...schemaEnum].sort(), [...VALID_ROLE_TYPES_LIST].sort());
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), [...VALID_ROLE_TYPES_LIST].sort());
});

test('un registro viejo con role numérico sigue siendo válido', () => {
  assert.deepEqual(employeeErrors({ ...base, role: '3', roleType: 'event_manager' }), []);
});
