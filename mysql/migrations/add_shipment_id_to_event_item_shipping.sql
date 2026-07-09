-- Fase 4b del plan de acción de performance SQL (audit 2026-07-07).
-- Reemplaza el JOIN vía JSON_EXTRACT(notes, '$.shipment_id') por una columna
-- real e indexable. Auditoría de datos (2026-07-08) confirmó 195/195 filas de
-- event_item_shipping con notes.shipment_id matcheando un company_shipments
-- real, y 0 filas con notes no-JSON — backfill de bajo riesgo.
--
-- Bonus de correctness: hoy `notes` es también un campo de texto libre editable
-- vía PATCH genérico (items_events.js allowedUpdates incluye "notes" y hace
-- `SET notes = ?`, un overwrite completo, no un merge) — eso podía borrar el
-- shipment_id embebido sin querer. Sacarlo a su propia columna elimina ese riesgo.
--
-- Orden obligatorio: correr esta migración ANTES de deployar el código que
-- deja de escribir/leer shipment_id desde `notes` (mysql/controllers/shipment.js).

-- ─── 1. Agregar columna shipment_id (mismo tipo que company_shipments.shipment_id: UUID string) ──
SET @dbname = DATABASE();
SET @tablename = "event_item_shipping";
SET @columnname = "shipment_id";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (column_name = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE event_item_shipping ADD COLUMN shipment_id VARCHAR(36) NULL"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ─── 2. Índice para el JOIN nuevo (eis.shipment_id = cs.shipment_id) ───────────
SET @indexname = "idx_event_item_shipping_shipment_id";
SET @preparedStatementIndex = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE (table_name = @tablename) AND (table_schema = @dbname) AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "CREATE INDEX idx_event_item_shipping_shipment_id ON event_item_shipping(shipment_id)"
));
PREPARE createIndexIfNotExists FROM @preparedStatementIndex;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ─── 3. Backfill desde el JSON legacy — idempotente (solo toca filas sin shipment_id todavía) ──
UPDATE event_item_shipping
SET shipment_id = JSON_UNQUOTE(JSON_EXTRACT(notes, '$.shipment_id'))
WHERE shipment_id IS NULL
  AND notes IS NOT NULL
  AND JSON_VALID(notes)
  AND JSON_EXTRACT(notes, '$.shipment_id') IS NOT NULL;
