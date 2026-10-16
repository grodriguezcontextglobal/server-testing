'use strict';

/**
 * W5 / R3: backfill del alcance por locación Mongo → SQL. Se prueba solo el plan
 * (función pura); el script lo imprime en dry-run y lo inserta con --apply.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { planLocationScopeBackfill, norm } = require('../mysql/scripts/backfill-location-scope');

let seq = 0;
const newId = () => `new-${++seq}`;

const emp = (user, locations, extra = {}) => ({
  user,
  active: true,
  preference: { managerLocation: locations.map((l) => (typeof l === 'string' ? { location: l, actions: { create: true, update: true, delete: false } } : l)) },
  ...extra,
});

const base = () => ({
  companies: [
    { company_name: 'Lincoln High', employees: [emp('ana@x.com', ['Main Office', 'Gym'])] },
  ],
  sqlCompanies: [
    { company_id: 7, company_name: 'Lincoln High' },
    { company_id: 8, company_name: 'Other School' },
  ],
  staffMembers: [{ staff_id: 100, email: 'ana@x.com' }],
  companyStaff: [{ id: 'cs-ana-7', company_id: 7, staff_id: 100, is_active: 1, role_level: 6, role_type: 'inventory_location_manager' }],
  locations: [
    { location_id: 1, company_id: 7, location_name: 'Main Office' },
    { location_id: 2, company_id: 7, location_name: 'Gym' },
    { location_id: 3, company_id: 8, location_name: 'Main Office' }, // mismo nombre, otra compañía
  ],
  existingAccess: [],
});

const plan = (input, opts = {}) => planLocationScopeBackfill(input, { newId, ...opts });
const reasons = (issues) => issues.map((i) => i.reason);

test('caso normal: crea una fila por locación, con el company_staff que ya existe y sus permisos', () => {
  const { inserts, issues, stats } = plan(base());
  assert.deepEqual(issues, []);
  assert.equal(stats.toInsert, 2);
  assert.deepEqual(
    inserts.map(({ company_staff_id, location_id, can_create, can_update, can_delete }) => ({ company_staff_id, location_id, can_create, can_update, can_delete })),
    [
      { company_staff_id: 'cs-ana-7', location_id: 1, can_create: true, can_update: true, can_delete: false },
      { company_staff_id: 'cs-ana-7', location_id: 2, can_create: true, can_update: true, can_delete: false },
    ],
  );
});

test('la locación se busca DENTRO de su compañía: "Main Office" de otra compañía no se cruza', () => {
  const { inserts } = plan(base());
  assert.ok(inserts.every((r) => r.location_id !== 3));
});

test('nombres de locación sin distinguir mayúsculas ni espacios ("gym " = "Gym")', () => {
  const input = base();
  input.companies[0].employees = [emp('ana@x.com', [' gym  '])];
  assert.equal(plan(input).inserts[0].location_id, 2);
  assert.equal(norm('  Main   Office '), 'main office');
});

test('no duplica: una fila que ya existe en SQL no se vuelve a crear', () => {
  const input = base();
  input.existingAccess = [{ company_staff_id: 'cs-ana-7', location_id: 1, can_create: 1, can_update: 1, can_delete: 0 }];
  const { inserts, issues, stats } = plan(input);
  assert.deepEqual(inserts.map((r) => r.location_id), [2]);
  assert.equal(stats.alreadyInSql, 1);
  assert.deepEqual(issues, []);
});

test('si los permisos de SQL difieren de Mongo se informa y se deja SQL', () => {
  const input = base();
  input.existingAccess = [{ company_staff_id: 'cs-ana-7', location_id: 1, can_create: 0, can_update: 0, can_delete: 0 }];
  const { inserts, issues } = plan(input);
  assert.equal(inserts.some((r) => r.location_id === 1), false);
  assert.deepEqual(reasons(issues), ['flags_differ_kept_sql']);
});

test('por defecto solo roles por locación (6, 7); --all-roles incluye los demás', () => {
  const input = base();
  input.companyStaff[0] = { ...input.companyStaff[0], role_level: 3, role_type: 'event_manager' };
  const def = plan(input);
  assert.equal(def.inserts.length, 0);
  assert.deepEqual(reasons(def.issues), ['role_not_location_scoped']);
  assert.equal(plan(input, { includeAllRoles: true }).inserts.length, 2);
});

test('informa lo que no resuelve, con el motivo (antes se descartaba en silencio)', () => {
  const input = base();
  input.companies = [
    { company_name: 'Ghost School', employees: [emp('x@x.com', ['A'])] },
    { company_name: 'Lincoln High', employees: [
      emp('nobody@x.com', ['Gym']),
      emp('ana@x.com', ['Library']),
    ] },
    { company_name: 'Other School', employees: [emp('ana@x.com', ['Main Office'])] },
  ];
  const { inserts, issues } = plan(input);
  assert.equal(inserts.length, 0);
  assert.deepEqual(reasons(issues).sort(), [
    'company_not_in_sql',          // Ghost School
    'location_not_in_sql',         // Library
    'no_company_staff_row',        // ana no es staff de Other School en SQL
    'staff_not_in_staff_member',   // nobody@x.com
  ].sort());
});

test('inactivos (en Mongo o en SQL) no reciben filas', () => {
  const a = base();
  a.companies[0].employees[0].active = false;
  assert.deepEqual(reasons(plan(a).issues), ['inactive']);
  const b = base();
  b.companyStaff[0].is_active = 0;
  assert.deepEqual(reasons(plan(b).issues), ['inactive']);
});

test('nombres ambiguos (dos locaciones iguales en la compañía, o compañía duplicada en SQL) no se adivinan', () => {
  const a = base();
  a.locations.push({ location_id: 9, company_id: 7, location_name: 'gym' });
  const ra = plan(a);
  assert.deepEqual(ra.inserts.map((r) => r.location_id), [1]);
  assert.deepEqual(reasons(ra.issues), ['location_name_ambiguous']);

  const b = base();
  b.sqlCompanies.push({ company_id: 70, company_name: 'lincoln high ' });
  assert.deepEqual(reasons(plan(b).issues), ['company_name_ambiguous_in_sql']);
});

test('la misma locación repetida en Mongo da una sola fila; email sin distinguir mayúsculas', () => {
  const input = base();
  input.companies[0].employees = [emp('ANA@X.com', ['Gym', 'gym'])];
  assert.equal(plan(input).inserts.length, 1);
});
