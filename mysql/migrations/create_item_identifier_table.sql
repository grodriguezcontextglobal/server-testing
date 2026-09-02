-- Fase 1 del plan de conteo por identificador (ver DESIGN_rfid_event_count.md § 3 y § 5).
--
-- Tabla de IDENTIFICADORES ESCANEABLES de un item: el EPC de su etiqueta RFID
-- y/o su código de barras. Un item puede tener los dos a la vez -- ese estado
-- mixto es el estado real durante toda la transición a RFID.
--
-- Por qué tabla nueva y no una columna en item_inv: trabajamos contra la base
-- de producción. Un CREATE TABLE es aditivo puro (nada lo lee hasta que código
-- nuevo lo lea, y el rollback es DROP TABLE), mientras que un ALTER sobre
-- item_inv es un online schema change sobre la tabla que casi todo el sistema
-- toca, con otro schema change como rollback.
--
-- NO se migran los seriales existentes acá dentro. serial_number es editable
-- (updateItemInTable lo tiene en allowedColumns), así que duplicarlo sería un
-- problema de sincronización permanente. Esta tabla guarda solo lo que no vive
-- en otro lado; la unificación de ambas fuentes ocurre en la CONSULTA.
--
-- Orden de aplicación: se puede correr con el código actual en producción y sin
-- coordinación de deploy -- nada la consulta todavía. Eso permite etiquetar los
-- dispositivos del evento y validar los datos ANTES de desplegar código.
--
-- Idempotente vía CREATE TABLE IF NOT EXISTS (molde: create_locations_table.sql).

CREATE TABLE IF NOT EXISTS item_identifier (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  item_id    INT NOT NULL,

  -- 'epc' | 'barcode'. VARCHAR y no ENUM: agregar un valor a un ENUM es otro
  -- schema change; la lista blanca vive en la aplicación (IDENTIFIER_TYPES en
  -- mysql/helpers/identifier.js).
  id_type    VARCHAR(16) NOT NULL,

  -- VARCHAR(64) cubre tanto el hex de un EPC-96 (24 chars) como un EPC-202 o un
  -- URI GS1 (urn:epc:id:giai:...).
  -- Collation _ci EXPLÍCITA: hace que 'abc' y 'ABC' colisionen en el UNIQUE, que
  -- es lo que se quiere porque normalizeIdentifier() ya guarda en mayúsculas. Si
  -- alguien la declarara _bin, dos casings del mismo tag convivirían y el conteo
  -- mentiría.
  id_value   VARCHAR(64) COLLATE utf8mb4_general_ci NOT NULL,

  -- Re-etiquetado (tag arrancado o dañado): se desactiva el viejo y se inserta
  -- el nuevo, en vez de borrar. El historial sale gratis.
  is_active  TINYINT(1) NOT NULL DEFAULT 1,

  create_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  update_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- LA restricción del proyecto: un identificador escaneable no puede resolver a
  -- dos equipos. Por tipo, así un EPC y un código de barras con el mismo string
  -- no chocan entre sí.
  --
  -- Ojo: NO existe UNIQUE (company_id, item_id), a propósito. Un item DEBE poder
  -- tener EPC *y* código de barras a la vez -- es el punto central del diseño --
  -- y además permite dos tags en un pelican grande, práctica real por
  -- confiabilidad de lectura.
  UNIQUE KEY uq_item_identifier_value (company_id, id_type, id_value),

  -- "dame los identificadores de estos items" (el LEFT JOIN del conjunto esperado).
  INDEX idx_item_identifier_item (company_id, item_id)
);

-- Sin FOREIGN KEY hacia item_inv: consistente con el resto del esquema, que no
-- tiene ninguna (PlanetScale históricamente no las admite).
--
-- NOTA sobre la unicidad de serial_number: NO se agrega ninguna restricción a
-- item_inv. Verificado en producción (2026-09-02) que los seriales duplicados
-- son mayormente POR DISEÑO -- bulkInsertItemRange acuña rangos secuenciales y
-- rangos que se solapan entre categorías son consecuencia esperada. Un
-- UNIQUE (company_id, serial_number) rompería insertBulkItem. La unicidad que el
-- conteo necesita es la de arriba, sobre la capa escaneable.
