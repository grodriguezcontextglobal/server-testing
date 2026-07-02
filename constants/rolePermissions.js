'use strict';

// Mapa estático de permisos por role_type.
// Espeja exactamente las inserciones de seed_roles_permissions.sql,
// con la adición de company:delete exclusivo para root_admin.
// Es la única fuente de verdad para la autorización en MongoDB;
// el sistema SQL la valida contra la tabla role_permissions en DB.

const FULL_ACCESS = [
  'inventory:create', 'inventory:read', 'inventory:update', 'inventory:delete',
  'event:create',     'event:read',     'event:update',     'event:delete',
  'consumer:create',  'consumer:read',  'consumer:update',  'consumer:delete',
  'transaction:create','transaction:read','transaction:update','transaction:delete',
  'location:create',  'location:read',  'location:update',  'location:delete',
  'staff:create',     'staff:read',     'staff:update',     'staff:delete',
  'staff:update_contact',
  'company:read',  'company:update',
  'billing:read',  'billing:update',
];

const ROLE_PERMISSIONS = {
  // Nivel 0 — único con company:delete (operación destructiva crítica)
  root_admin: new Set([...FULL_ACCESS, 'company:delete']),

  // Niveles 1 y 2 — acceso completo excepto company:delete
  admin:        new Set(FULL_ACCESS),
  sale_manager: new Set(FULL_ACCESS),

  // Nivel 3 — eventos, consumers, transacciones + inventory(RU)
  event_manager: new Set([
    'event:create',       'event:read',       'event:update',       'event:delete',
    'consumer:create',    'consumer:read',    'consumer:update',    'consumer:delete',
    'transaction:create', 'transaction:read', 'transaction:update', 'transaction:delete',
    'inventory:read',     'inventory:update',
    'staff:update_contact',
  ]),

  // Nivel 4 — inventario y locaciones, sin restricción por locación
  inventory_manager: new Set([
    'inventory:create', 'inventory:read', 'inventory:update', 'inventory:delete',
    'location:create',  'location:read',  'location:update',  'location:delete',
    'staff:update_contact',
  ]),

  // Nivel 5 — solo transacciones
  assistant: new Set([
    'transaction:create', 'transaction:read', 'transaction:update', 'transaction:delete',
    'staff:update_contact',
  ]),

  // Nivel 6 — inventory + location CRUD, con scope de locación
  inventory_location_manager: new Set([
    'inventory:create', 'inventory:read', 'inventory:update', 'inventory:delete',
    'location:create',  'location:read',  'location:update',  'location:delete',
    'staff:update_contact',
  ]),

  // Nivel 7 — inventory + location solo lectura/actualización, con scope de locación
  inventory_location_assistant: new Set([
    'inventory:read',  'inventory:update',
    'location:read',   'location:update',
    'staff:update_contact',
  ]),
};

/**
 * Verifica si un role_type tiene permiso para resource:action.
 * @param {string} roleType  - Uno de los 8 role_types canónicos
 * @param {string} resource  - e.g. 'inventory', 'event', 'company'
 * @param {string} action    - e.g. 'create', 'read', 'update', 'delete'
 * @returns {boolean}
 */
function hasPermission(roleType, resource, action) {
  const perms = ROLE_PERMISSIONS[roleType];
  if (!perms) return false;
  return perms.has(`${resource}:${action}`);
}

module.exports = { ROLE_PERMISSIONS, hasPermission };
