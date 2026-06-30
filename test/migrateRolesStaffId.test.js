'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Importamos solo las funciones puras exportadas por el script
const { buildStaffMemberMap, buildStaffInserts } = require('../mysql/scripts/migrate-roles');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const staffMemberRows = [
  { staff_id: 74,  email: 'grodriguez@contextglobal.com' },
  { staff_id: 99,  email: 'other@example.com' },
  { staff_id: 101, email: 'manager@example.com' },
];

const adminUsers = [
  { _id: { toString: () => '661d7f57b5dd5c170d866933' }, email: 'grodriguez@contextglobal.com' },
  { _id: { toString: () => 'aabbccdd11223344aabbcc01' }, email: 'other@example.com' },
];

const roleIdByType = { root_admin: 1, admin: 2, sale_manager: 3, event_manager: 4, inventory_manager: 5, assistant: 6 };
const sqlCompanyIdByName = { 'Acme Corp': 10 };
const locationIdByName   = { 'Main Warehouse': 3 };

// ─── buildStaffMemberMap ──────────────────────────────────────────────────────

test('buildStaffMemberMap: construye mapa email → staff_member.id (INT)', () => {
  const map = buildStaffMemberMap(staffMemberRows);

  assert.equal(map['grodriguez@contextglobal.com'], 74);
  assert.equal(map['other@example.com'],            99);
  assert.equal(map['manager@example.com'],          101);
});

test('buildStaffMemberMap: retorna objeto vacío cuando no hay filas', () => {
  const map = buildStaffMemberMap([]);
  assert.deepEqual(map, {});
});

// ─── buildStaffInserts — staff_id debe ser INT ────────────────────────────────

test('buildStaffInserts: staff_id en el insert es el INT de staff_member (no MongoDB ObjectId)', () => {
  const companies = [{
    company_name: 'Acme Corp',
    employees: [{
      user:     'grodriguez@contextglobal.com',
      roleType: 'admin',
      active:   true,
      preference: {},
    }],
  }];
  const staffSqlIdByEmail = buildStaffMemberMap(staffMemberRows);

  const { staffInserts } = buildStaffInserts(
    companies, staffSqlIdByEmail, roleIdByType, sqlCompanyIdByName, locationIdByName
  );

  assert.equal(staffInserts.length, 1);
  const insert = staffInserts[0];

  assert.equal(typeof insert.staff_id, 'number', 'staff_id debe ser INT');
  assert.equal(insert.staff_id, 74);
  assert.equal(insert.company_id, 10);       // INT de company_info
  assert.equal(insert.role_id, 2);           // role_id para 'admin'
});

test('buildStaffInserts: omite employee cuyo email no existe en staff_member', () => {
  const companies = [{
    company_name: 'Acme Corp',
    employees: [{
      user:     'unknown@nowhere.com',
      roleType: 'admin',
      active:   true,
      preference: {},
    }],
  }];
  const staffSqlIdByEmail = buildStaffMemberMap(staffMemberRows);

  const { staffInserts, skippedStaff } = buildStaffInserts(
    companies, staffSqlIdByEmail, roleIdByType, sqlCompanyIdByName, locationIdByName
  );

  assert.equal(staffInserts.length, 0);
  assert.equal(skippedStaff.length, 1);
  assert.equal(skippedStaff[0].email, 'unknown@nowhere.com');
});

test('buildStaffInserts: omite company que no tiene match en company_info SQL', () => {
  const companies = [{
    company_name: 'Ghost Corp',
    employees: [{ user: 'grodriguez@contextglobal.com', roleType: 'admin', active: true, preference: {} }],
  }];
  const staffSqlIdByEmail = buildStaffMemberMap(staffMemberRows);

  const { staffInserts, skippedCompanies } = buildStaffInserts(
    companies, staffSqlIdByEmail, roleIdByType, sqlCompanyIdByName, locationIdByName
  );

  assert.equal(staffInserts.length, 0);
  assert.equal(skippedCompanies.length, 1);
  assert.equal(skippedCompanies[0], 'Ghost Corp');
});
