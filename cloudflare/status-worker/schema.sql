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

-- Lo que Kuma cuenta desde dentro de la VM, monitor a monitor. El estado del
-- componente publico se DERIVA de estas filas (ver componentFromMonitors), asi
-- que un worker parado degrada el componente y su recuperacion lo restaura sin
-- que haya que recordar cuantos habia caidos.
CREATE TABLE IF NOT EXISTS monitor_state (
  monitor    TEXT PRIMARY KEY,
  component  TEXT NOT NULL,
  status     TEXT NOT NULL,   -- operational | down
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitor_state_component ON monitor_state (component);

-- Incidentes escritos A MANO. El estado automatico contesta "esta arriba?"; un
-- cliente que ve rojo quiere leer "estamos investigando, afecta a los correos,
-- actualizamos en 30 min". Eso no lo genera un sondeo.
CREATE TABLE IF NOT EXISTS incidents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  state       TEXT NOT NULL,   -- investigating | identified | monitoring | resolved
  started_at  TEXT NOT NULL,
  resolved_at TEXT             -- NULL mientras sigue abierto
);
CREATE INDEX IF NOT EXISTS idx_incidents_open ON incidents (resolved_at, started_at);

-- Cada actualizacion publicada de un incidente. Se guardan todas, y se muestran
-- en orden: el valor de una pagina de estado no es el ultimo mensaje, es poder
-- seguir como se fue resolviendo.
CREATE TABLE IF NOT EXISTS incident_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  at          TEXT NOT NULL,
  state       TEXT NOT NULL,
  message     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incident_updates ON incident_updates (incident_id, at);
