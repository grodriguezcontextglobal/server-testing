-- Agrega permisos inventory:read e inventory:update al rol event_manager.
-- Necesario para revisar y alocar inventario al crear/gestionar eventos.
INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id
  FROM roles r, permissions p
  WHERE r.role_type = 'event_manager'
    AND p.resource = 'inventory'
    AND p.action IN ('read', 'update');
