-- Agrega los roles inventory_location_manager e inventory_location_assistant.
-- inventory_location_manager (nivel 6): inventory(CRUD) + location(CRUD), scope de locación.
-- inventory_location_assistant (nivel 7): inventory(RU) + location(RU), scope de locación.
-- A diferencia de inventory_manager (nivel 4), estos roles NO están en FULL_INVENTORY_ROLES
-- y son restringidos a las locaciones asignadas en staff_location_access.

INSERT IGNORE INTO roles (role_level, role_type, label) VALUES
  (6, 'inventory_location_manager',   'Inventory Location Manager'),
  (7, 'inventory_location_assistant', 'Inventory Location Assistant');

INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.role_type = 'inventory_location_manager'
    AND p.resource IN ('inventory','location');

INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.role_type = 'inventory_location_assistant'
    AND p.resource IN ('inventory','location')
    AND p.action IN ('read','update');
