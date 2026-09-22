'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// RED: este archivo no existe todavía.
const { ROLE_PERMISSIONS, hasPermission } = require('../constants/rolePermissions');

// ─── contrato básico ──────────────────────────────────────────────────────────

test('ROLE_PERMISSIONS exporta los 10 role_types canónicos', () => {
  const expected = [
    'root_admin','admin','sale_manager','event_manager',
    'inventory_manager','assistant',
    'inventory_location_manager','inventory_location_assistant',
    'category_manager','category_assistant',
  ];
  expected.forEach(rt => {
    assert.ok(ROLE_PERMISSIONS[rt] instanceof Set, `${rt} debe ser un Set`);
  });
  assert.equal(Object.keys(ROLE_PERMISSIONS).length, 10, 'exactamente 10 entradas');
});

// ─── staff:update_contact es ALL_ROLES ────────────────────────────────────────

test('staff:update_contact está en los 10 roles', () => {
  Object.entries(ROLE_PERMISSIONS).forEach(([role, perms]) => {
    assert.ok(perms.has('staff:update_contact'), `${role} debe tener staff:update_contact`);
  });
});

// ─── category-scoped roles (nivel 8/9) ────────────────────────────────────────

test('category_manager: inventory CRUD, sin location ni otros recursos', () => {
  const perms = ROLE_PERMISSIONS.category_manager;
  ['create','read','update','delete'].forEach(a =>
    assert.ok(perms.has(`inventory:${a}`), `debe tener inventory:${a}`));
  assert.ok(!perms.has('location:read'),  'no debe tener permisos de location');
  assert.ok(!perms.has('event:read'),     'no debe tener permisos de event');
  assert.ok(!perms.has('company:read'),   'no debe tener permisos de company');
});

test('category_assistant: solo inventory read/update', () => {
  const perms = ROLE_PERMISSIONS.category_assistant;
  assert.ok(perms.has('inventory:read'));
  assert.ok(perms.has('inventory:update'));
  assert.ok(!perms.has('inventory:create'), 'no debe tener inventory:create');
  assert.ok(!perms.has('inventory:delete'), 'no debe tener inventory:delete');
  assert.ok(!perms.has('location:read'),    'no debe tener permisos de location');
});

// ─── full-access roles (0,1,2) ───────────────────────────────────────────────

const FULL_RESOURCES = ['inventory','event','consumer','transaction','location','staff','company','billing'];

test('root_admin tiene acceso CRUD a todos los recursos principales', () => {
  const perms = ROLE_PERMISSIONS.root_admin;
  ['inventory','event','consumer','transaction','location'].forEach(res => {
    ['create','read','update','delete'].forEach(action => {
      assert.ok(perms.has(`${res}:${action}`), `root_admin debe tener ${res}:${action}`);
    });
  });
  assert.ok(perms.has('company:read'));
  assert.ok(perms.has('company:update'));
  assert.ok(perms.has('billing:read'));
  assert.ok(perms.has('billing:update'));
});

test('root_admin es el único con company:delete', () => {
  assert.ok(ROLE_PERMISSIONS.root_admin.has('company:delete'),    'root_admin debe tener company:delete');
  assert.ok(!ROLE_PERMISSIONS.admin.has('company:delete'),        'admin NO debe tener company:delete');
  assert.ok(!ROLE_PERMISSIONS.sale_manager.has('company:delete'), 'sale_manager NO debe tener company:delete');
  assert.ok(!ROLE_PERMISSIONS.event_manager.has('company:delete'),'event_manager NO debe tener company:delete');
});

test('admin y sale_manager tienen los mismos permisos entre sí (y sin company:delete)', () => {
  const adminPerms = [...ROLE_PERMISSIONS.admin].sort().join(',');
  const salePerms  = [...ROLE_PERMISSIONS.sale_manager].sort().join(',');
  assert.equal(adminPerms, salePerms, 'admin y sale_manager deben ser idénticos');
});

// ─── event_manager (nivel 3) ─────────────────────────────────────────────────

test('event_manager tiene inventory:read e inventory:update pero NO create ni delete', () => {
  const perms = ROLE_PERMISSIONS.event_manager;
  assert.ok(perms.has('inventory:read'));
  assert.ok(perms.has('inventory:update'));
  assert.ok(!perms.has('inventory:create'), 'event_manager NO debe tener inventory:create');
  assert.ok(!perms.has('inventory:delete'), 'event_manager NO debe tener inventory:delete');
});

test('event_manager tiene event/consumer/transaction CRUD completo', () => {
  const perms = ROLE_PERMISSIONS.event_manager;
  ['event','consumer','transaction'].forEach(res => {
    ['create','read','update','delete'].forEach(action => {
      assert.ok(perms.has(`${res}:${action}`), `event_manager debe tener ${res}:${action}`);
    });
  });
});

test('event_manager NO tiene permisos de company ni billing ni location ni staff(CRUD)', () => {
  const perms = ROLE_PERMISSIONS.event_manager;
  assert.ok(!perms.has('company:update'));
  assert.ok(!perms.has('billing:read'));
  assert.ok(!perms.has('location:create'));
  assert.ok(!perms.has('staff:create'));
});

// ─── inventory_manager (nivel 4) ─────────────────────────────────────────────

test('inventory_manager tiene inventory y location CRUD completo', () => {
  const perms = ROLE_PERMISSIONS.inventory_manager;
  ['inventory','location'].forEach(res => {
    ['create','read','update','delete'].forEach(action => {
      assert.ok(perms.has(`${res}:${action}`), `inventory_manager debe tener ${res}:${action}`);
    });
  });
  assert.ok(!perms.has('event:create'), 'inventory_manager NO debe tener event:create');
});

// ─── assistant (nivel 5) ─────────────────────────────────────────────────────

test('assistant solo tiene transaction CRUD + update_contact', () => {
  const perms = ROLE_PERMISSIONS.assistant;
  ['transaction:create','transaction:read','transaction:update','transaction:delete','staff:update_contact']
    .forEach(p => assert.ok(perms.has(p), `assistant debe tener ${p}`));
  assert.equal(perms.size, 5, 'assistant tiene exactamente 5 permisos');
});

// ─── inventory_location_manager (nivel 6) ────────────────────────────────────

test('inventory_location_manager tiene los mismos permisos que inventory_manager', () => {
  const mgr  = [...ROLE_PERMISSIONS.inventory_manager].sort().join(',');
  const locMgr = [...ROLE_PERMISSIONS.inventory_location_manager].sort().join(',');
  assert.equal(mgr, locMgr, 'ambos managers de inventory deben tener los mismos permisos');
});

// ─── inventory_location_assistant (nivel 7) ──────────────────────────────────

test('inventory_location_assistant tiene solo inventory(RU) + location(RU) + update_contact', () => {
  const perms = ROLE_PERMISSIONS.inventory_location_assistant;
  assert.ok(perms.has('inventory:read'));
  assert.ok(perms.has('inventory:update'));
  assert.ok(perms.has('location:read'));
  assert.ok(perms.has('location:update'));
  assert.ok(!perms.has('inventory:create'), 'no debe tener inventory:create');
  assert.ok(!perms.has('inventory:delete'), 'no debe tener inventory:delete');
  assert.equal(perms.size, 5, 'exactamente 5 permisos');
});

// ─── helper hasPermission ─────────────────────────────────────────────────────

test('hasPermission(role_type, resource, action) retorna booleano correcto', () => {
  assert.equal(hasPermission('root_admin',  'company',   'delete'), true);
  assert.equal(hasPermission('admin',       'company',   'delete'), false);
  assert.equal(hasPermission('assistant',   'inventory', 'create'), false);
  assert.equal(hasPermission('event_manager','event',    'read'),   true);
  assert.equal(hasPermission('nonexistent', 'event',    'read'),   false);
});
