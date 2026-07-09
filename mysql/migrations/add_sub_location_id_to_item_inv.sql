-- Fase 4a del plan de acción de performance SQL.
-- Agrega item_inv.sub_location_id (INT) — apunta al nodo HOJA del path jerárquico
-- que hoy vive como JSON array de nombres en item_inv.sub_location.
--
-- Contexto (auditoría 2026-07-08 sobre devitrak_db): la migración original
-- create_sub_locations_table.sql se aplicó solo a medias — creó la tabla
-- sub_locations (94 nodos) pero NUNCA agregó esta columna ni corrió el backfill.
-- Esta migración solo AGREGA la columna + índice; el backfill de datos se hace
-- aparte con el script Node mysql/scripts/backfill-sub-location-id.js (tiene
-- --dry-run), que reutiliza la lógica de resolución ya testeada.
--
-- Orden: correr esta migración en DBeaver, LUEGO el script de backfill, y recién
-- ahí deployar el código (el código escribe/lee sub_location_id con fallback al
-- JSON legacy, así que no rompe si el backfill aún no corrió — pero la búsqueda
-- por sub-locación no aprovecha el índice hasta que el backfill complete).

-- ─── Agregar columna sub_location_id (idempotente) ─────────────────────────────
SET @dbname = DATABASE();
SET @tablename = "item_inv";
SET @columnname = "sub_location_id";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (column_name = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE item_inv ADD COLUMN sub_location_id INT NULL"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ─── Índice para el filtro nuevo (WHERE ... AND sub_location_id IN (...)) ───────
SET @indexname = "idx_item_inv_sub_location_id";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_item_inv_sub_location_id ON item_inv(sub_location_id)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;
