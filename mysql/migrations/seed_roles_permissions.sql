-- ─── ROLES ────────────────────────────────────────────────────────────────────
-- role_level único por rol, refleja ROLE_LEVELS refactorizado (0-7)
INSERT IGNORE INTO roles (role_level, role_type, label) VALUES
  (0, 'root_admin',                   'Root Administrator'),
  (1, 'admin',                        'Administrator'),
  (2, 'sale_manager',                 'Sale Manager'),
  (3, 'event_manager',                'Event Manager'),
  (4, 'inventory_manager',            'Inventory Manager'),
  (5, 'assistant',                    'Assistant'),
  (6, 'inventory_location_manager',   'Inventory Location Manager'),
  (7, 'inventory_location_assistant', 'Inventory Location Assistant');

-- ─── PERMISSIONS ──────────────────────────────────────────────────────────────
INSERT IGNORE INTO permissions (resource, action) VALUES
  ('inventory','create'),('inventory','read'),('inventory','update'),('inventory','delete'),
  ('event','create'),('event','read'),('event','update'),('event','delete'),
  ('consumer','create'),('consumer','read'),('consumer','update'),('consumer','delete'),
  ('transaction','create'),('transaction','read'),('transaction','update'),('transaction','delete'),
  ('location','create'),('location','read'),('location','update'),('location','delete'),
  ('staff','create'),('staff','read'),('staff','update'),('staff','delete'),
  ('staff','update_contact'),
  ('company','read'),('company','update'),
  ('billing','read'),('billing','update');

-- ─── ROLE_PERMISSIONS ─────────────────────────────────────────────────────────

-- FULL_ACCESS (root_admin / admin / sale_manager — niveles 0, 1, 2): todo excepto update_contact
INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.role_type IN ('root_admin','admin','sale_manager')
    AND NOT (p.resource = 'staff' AND p.action = 'update_contact');

-- event_manager (nivel 3): eventos + consumers + transactions + inventory(RU)
INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.role_type = 'event_manager'
    AND (
      (p.resource IN ('event','consumer','transaction') AND p.action != 'update_contact')
      OR (p.resource = 'inventory' AND p.action IN ('read','update'))
    );

-- inventory_manager (nivel 4): acceso total sin restricción de locación
INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.role_type = 'inventory_manager'
    AND p.resource IN ('inventory','location');

-- assistant (nivel 5): solo transactions
INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.role_type = 'assistant'
    AND p.resource = 'transaction';

-- inventory_location_manager (nivel 6): inventory(CRUD) + location(CRUD), con scope de locación
INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.role_type = 'inventory_location_manager'
    AND p.resource IN ('inventory','location');

-- inventory_location_assistant (nivel 7): inventory(RU) + location(RU), con scope de locación
INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.role_type = 'inventory_location_assistant'
    AND p.resource IN ('inventory','location')
    AND p.action IN ('read','update');

-- staff:update_contact es ALL_ROLES — aplica a los 8 roles
INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE p.resource = 'staff' AND p.action = 'update_contact';
