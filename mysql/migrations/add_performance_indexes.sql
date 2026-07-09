-- Fase 1 del plan de acción de performance SQL (ver auditoría 2026-07-07).
-- Solo agrega índices (no borra, no altera datos, no cambia tipos de columna).
-- Sigue el mismo patrón idempotente que create_locations_table.sql / create_sub_locations_table.sql:
-- chequea INFORMATION_SCHEMA.STATISTICS antes de crear, así es seguro re-ejecutar este archivo.
--
-- Orden de prioridad (según el audit):
--   1) company_staff / role_permissions / staff_location_access -> hot path de autorización,
--      corre en middlewares/authorizePermission.js y mysql/helpers/staffAccess.js en casi cada request.
--   2) item_inv -> tabla más consultada del sistema.
--   3) event_item_shipping / sub_locations -> joins frecuentes en shipment/inventory.
--   4) lease_info -> revisar nombres de columna contra el schema real antes de correr este bloque
--      (no se pudo confirmar columna por columna solo leyendo el código de mysql/controllers/lease.js).

-- ─── company_staff (company_id, staff_id, is_active) ───────────────────────────
-- Usado por: authorizePermission.js, staffAccess.js -> WHERE cs.company_id = ? AND cs.staff_id = ? AND cs.is_active = 1
SET @dbname = DATABASE();
SET @tablename = "company_staff";
SET @indexname = "idx_company_staff_lookup";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_company_staff_lookup ON company_staff(company_id, staff_id, is_active)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── role_permissions (role_id, permission_id) ─────────────────────────────────
-- Usado por: authorizePermission.js -> JOIN role_permissions rp ON cs.role_id = rp.role_id
SET @dbname = DATABASE();
SET @tablename = "role_permissions";
SET @indexname = "idx_role_permissions_role_id";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id, permission_id)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── staff_location_access (company_staff_id) ──────────────────────────────────
-- Usado por: staffAccess.js -> WHERE company_staff_id = ?
SET @dbname = DATABASE();
SET @tablename = "staff_location_access";
SET @indexname = "idx_staff_location_access_company_staff";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_staff_location_access_company_staff ON staff_location_access(company_staff_id)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── staff_location_access (location_id) ───────────────────────────────────────
-- Usado por: joins locations <- staff_location_access ON location_id
SET @dbname = DATABASE();
SET @tablename = "staff_location_access";
SET @indexname = "idx_staff_location_access_location";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_staff_location_access_location ON staff_location_access(location_id)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── item_inv (company_id, warehouse, enableAssignFeature) ─────────────────────
SET @dbname = DATABASE();
SET @tablename = "item_inv";
SET @indexname = "idx_item_inv_company_warehouse";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_item_inv_company_warehouse ON item_inv(company_id, warehouse, enableAssignFeature)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── item_inv (company_id, serial_number) ──────────────────────────────────────
SET @dbname = DATABASE();
SET @tablename = "item_inv";
SET @indexname = "idx_item_inv_company_serial";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_item_inv_company_serial ON item_inv(company_id, serial_number)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── item_inv (company_id, category_name, item_group) ──────────────────────────
SET @dbname = DATABASE();
SET @tablename = "item_inv";
SET @indexname = "idx_item_inv_company_category_group";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_item_inv_company_category_group ON item_inv(company_id, category_name, item_group)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── event_item_shipping (event_id, company_id) ────────────────────────────────
SET @dbname = DATABASE();
SET @tablename = "event_item_shipping";
SET @indexname = "idx_event_item_shipping_event_company";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_event_item_shipping_event_company ON event_item_shipping(event_id, company_id)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── sub_locations (location_id, name) ─────────────────────────────────────────
SET @dbname = DATABASE();
SET @tablename = "sub_locations";
SET @indexname = "idx_sub_locations_name";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_sub_locations_name ON sub_locations(location_id, name)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── lease_info (company_id, device_id) ────────────────────────────────────────
-- ⚠ Verificar nombres de columna reales antes de correr este bloque:
-- se infirió de mysql/controllers/lease.js pero no se confirmó contra el schema en PlanetScale.
SET @dbname = DATABASE();
SET @tablename = "lease_info";
SET @indexname = "idx_lease_info_company_device";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_lease_info_company_device ON lease_info(company_id, device_id)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;
