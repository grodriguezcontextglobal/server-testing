-- Esquema D1 del vigilante externo.
--
-- Por qué D1 y no PocketBase (DESIGN_monitoring_uptime_kuma.md §7.4): PocketBase
-- es un binario que necesita una máquina encendida con disco persistente, o sea
-- exactamente el coste que este diseño evita. Y KV tampoco sirve: su límite de
-- escrituras del plan gratuito se queda corto frente a un sondeo por minuto.

-- Un registro por sondeo. Es la materia prima del porcentaje de disponibilidad,
-- y se poda a 90 días desde el propio Worker.
CREATE TABLE IF NOT EXISTS checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  component  TEXT NOT NULL,
  at         TEXT NOT NULL,
  observed   TEXT NOT NULL,   -- operational | degraded | down
  latency_ms INTEGER,
  detail     TEXT             -- INTERNO: puede llevar mensajes de error, nunca se publica
);
CREATE INDEX IF NOT EXISTS idx_checks_component_at ON checks (component, at);

-- El estado PUBLICADO de cada componente, que no es el último sondeo: un fallo
-- suelto no cambia esto hasta acumular FAILURES_BEFORE_DOWN seguidos.
CREATE TABLE IF NOT EXISTS component_state (
  component  TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  failures   INTEGER NOT NULL DEFAULT 0,  -- fallos consecutivos aún no publicados
  since      TEXT NOT NULL,               -- desde cuándo está en este estado
  updated_at TEXT NOT NULL
);

-- Transiciones. Es el historial de incidentes, y la base para poder escribir a
-- mano un mensaje del tipo "estamos investigando" cuando toque (§8.3).
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  component   TEXT NOT NULL,
  at          TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_at ON events (at);
