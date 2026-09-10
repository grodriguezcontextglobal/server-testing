'use strict';

/**
 * Métricas por endpoint: contador, latencia y tasa de error.
 *
 * POR QUÉ EXISTE: hoy no hay ni latencia ni tráfico por ruta, así que cualquier
 * decisión sobre concurrencia es una apuesta. `requestLogger` ya escribe una
 * línea por petición a winston, pero nadie las agrega, y grepear logs no da un
 * p95. Esto es la Fase 0 de `BACKLOG_infra.md` T1 y también la entrada que pide
 * la Fase 0 de `DESIGN_go_migration.md`.
 *
 * TRES DECISIONES DE DISEÑO, todas por el escenario de 5.000 peticiones
 * simultáneas de clientes distintos. A esa escala el sistema de medición es
 * perfectamente capaz de convertirse en el problema:
 *
 * 1. NO HAY UN VIAJE A REDIS POR PETICIÓN. Se agrega en memoria del proceso
 *    (incrementar propiedades de un objeto, coste despreciable) y se vuelca en
 *    UN pipeline cada `FLUSH_MS`. Con 5.000 req/s eso son ~5.000 incrementos
 *    locales y una escritura en red cada 10s, en vez de 5.000 round trips.
 *
 * 2. CARDINALIDAD ACOTADA. Se agrupa por PLANTILLA de ruta (`/api/db_item/:id`),
 *    nunca por la ruta con valores, y JAMÁS por company_id: con 5.000 clientes,
 *    etiquetar por tenant son 5.000 series por ruta y Redis se convierte en el
 *    cuello de botella. Los tenants se cuentan aparte, en un top-N acotado, que
 *    es lo que hace falta para responder "quién nos está martillando" sin pagar
 *    la explosión.
 *
 * 3. VENTANAS POR HORA CON TTL. Las claves llevan la hora, así que un p95
 *    acumulado desde el arranque —que esconde los picos, que es justo lo que se
 *    busca— no es la única vista posible, y Redis se limpia solo sin ninguna
 *    tarea de mantenimiento.
 *
 * Los cuatro procesos del cluster escriben sobre las MISMAS claves con HINCRBY,
 * que es atómico, así que la vista es del cluster entero y no del proceso que
 * atendió `/api/metrics`.
 */

const { clientRedis } = require("../database/cacheMemoryConfig");
const logger = require("./logger");

/** Cortes en ms. El último implícito es +Inf, que va a `bOver`. */
const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

const FLUSH_MS = Number(process.env.METRICS_FLUSH_MS || 10_000);
const WINDOW_TTL_S = Number(process.env.METRICS_WINDOW_TTL_S || 3 * 3600);

// Topes de cardinalidad. Rebasarlos no pierde el dato: lo acumula en una clave
// de desborde, que además es la señal de que hay rutas sin plantillear.
const MAX_ROUTES = Number(process.env.METRICS_MAX_ROUTES || 300);
const MAX_TENANTS = Number(process.env.METRICS_MAX_TENANTS || 200);

const OVERFLOW_ROUTE = "__overflow__";
const OTHER_TENANT = "__other__";

let routeStats = new Map();
let tenantStats = new Map();
let flushTimer = null;
let flushing = false;

const emptyRow = () => ({
  count: 0,
  sumMs: 0,
  maxMs: 0,
  buckets: new Array(BUCKETS_MS.length).fill(0),
  over: 0,
  s2xx: 0,
  s4xx: 0,
  s5xx: 0,
});

const bucketFor = (ms) => {
  for (let i = 0; i < BUCKETS_MS.length; i++) {
    if (ms <= BUCKETS_MS[i]) return i;
  }
  return -1; // +Inf
};

const hourKey = (at = Date.now()) => Math.floor(at / 3_600_000);

/**
 * Registra una petición terminada. Nunca lanza: una métrica no puede tumbar
 * una respuesta que ya se sirvió.
 */
const record = ({ route, method = "GET", statusCode = 0, durationMs = 0, tenant } = {}) => {
  try {
    let key = `${method.toUpperCase()} ${route || OVERFLOW_ROUTE}`;
    if (!routeStats.has(key) && routeStats.size >= MAX_ROUTES) {
      key = `${method.toUpperCase()} ${OVERFLOW_ROUTE}`;
    }

    let row = routeStats.get(key);
    if (!row) {
      row = emptyRow();
      routeStats.set(key, row);
    }

    const ms = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    row.count += 1;
    row.sumMs += ms;
    if (ms > row.maxMs) row.maxMs = ms;

    const b = bucketFor(ms);
    if (b === -1) row.over += 1;
    else row.buckets[b] += 1;

    if (statusCode >= 500) row.s5xx += 1;
    else if (statusCode >= 400) row.s4xx += 1;
    else if (statusCode >= 200) row.s2xx += 1;

    if (tenant) {
      const tKey = tenantStats.has(tenant) || tenantStats.size < MAX_TENANTS ? tenant : OTHER_TENANT;
      tenantStats.set(tKey, (tenantStats.get(tKey) || 0) + 1);
    }
  } catch (error) {
    // Deliberadamente mudo: ya se respondió al cliente.
  }
};

/** Se lleva lo acumulado y deja los contadores a cero, en un solo paso. */
const drain = () => {
  const routes = routeStats;
  const tenants = tenantStats;
  routeStats = new Map();
  tenantStats = new Map();
  return { routes, tenants };
};

const routeHashKey = (hour, key) => `metrics:h${hour}:route:${key}`;
const tenantHashKey = (hour) => `metrics:h${hour}:tenant`;

/**
 * Vuelca lo acumulado a Redis en un pipeline. Si Redis no está, lo REPONE en
 * memoria en vez de descartarlo: perder diez segundos de métricas por un
 * hipo de red sería aceptable, pero perderlas en silencio sin saber que se
 * perdieron no lo es.
 */
const flush = async ({ redisFn = clientRedis, at = Date.now() } = {}) => {
  if (flushing) return { skipped: true };
  if (routeStats.size === 0 && tenantStats.size === 0) return { flushed: 0 };

  flushing = true;
  const { routes, tenants } = drain();
  try {
    const client = await redisFn();
    const hour = hourKey(at);
    const pipeline = client.multi();

    for (const [key, row] of routes) {
      const hash = routeHashKey(hour, key);
      const fields = {
        count: row.count,
        sum_ms: row.sumMs,
        over: row.over,
        s2xx: row.s2xx,
        s4xx: row.s4xx,
        s5xx: row.s5xx,
      };
      row.buckets.forEach((value, i) => {
        if (value) fields[`b${i}`] = value;
      });
      for (const [field, value] of Object.entries(fields)) {
        if (value) pipeline.hIncrBy(hash, field, value);
      }
      // max no es sumable, así que se guarda aparte y el snapshot toma el mayor.
      if (row.maxMs) pipeline.hSet(hash, `max_ms_p${process.pid}`, String(row.maxMs));
      pipeline.expire(hash, WINDOW_TTL_S);
    }

    if (tenants.size) {
      const hash = tenantHashKey(hour);
      for (const [tenant, count] of tenants) pipeline.hIncrBy(hash, tenant, count);
      pipeline.expire(hash, WINDOW_TTL_S);
    }

    await pipeline.exec();
    return { flushed: routes.size };
  } catch (error) {
    // Reponer lo drenado: los contadores nuevos que hayan entrado mientras
    // tanto se suman, no se pisan.
    for (const [key, row] of routes) {
      const current = routeStats.get(key);
      if (!current) routeStats.set(key, row);
      else {
        current.count += row.count;
        current.sumMs += row.sumMs;
        current.over += row.over;
        current.s2xx += row.s2xx;
        current.s4xx += row.s4xx;
        current.s5xx += row.s5xx;
        current.maxMs = Math.max(current.maxMs, row.maxMs);
        row.buckets.forEach((v, i) => { current.buckets[i] += v; });
      }
    }
    for (const [tenant, count] of tenants) {
      tenantStats.set(tenant, (tenantStats.get(tenant) || 0) + count);
    }
    logger.warn("metrics: flush failed, counters kept in memory", { error: error.message });
    return { flushed: 0, error: error.message };
  } finally {
    flushing = false;
  }
};

/**
 * Percentil a partir de los cortes, con interpolación lineal dentro del bucket
 * que cruza el objetivo. Es lo mismo que hace `histogram_quantile` de
 * Prometheus, y tiene su misma limitación: la precisión la marca el ancho del
 * bucket, no el número de muestras.
 */
const percentile = (row, q) => {
  const total = row.count;
  if (!total) return 0;
  const target = q * total;
  let cumulative = 0;
  for (let i = 0; i < BUCKETS_MS.length; i++) {
    const inBucket = row.buckets[i] || 0;
    if (cumulative + inBucket >= target) {
      if (!inBucket) return BUCKETS_MS[i];
      const lower = i === 0 ? 0 : BUCKETS_MS[i - 1];
      const ratio = (target - cumulative) / inBucket;
      return Math.round(lower + (BUCKETS_MS[i] - lower) * ratio);
    }
    cumulative += inBucket;
  }
  // Cayó en +Inf: lo más honesto es el máximo observado, no un número inventado.
  return row.maxMs || BUCKETS_MS[BUCKETS_MS.length - 1];
};

const parseRow = (hash = {}) => {
  const row = emptyRow();
  row.count = Number(hash.count || 0);
  row.sumMs = Number(hash.sum_ms || 0);
  row.over = Number(hash.over || 0);
  row.s2xx = Number(hash.s2xx || 0);
  row.s4xx = Number(hash.s4xx || 0);
  row.s5xx = Number(hash.s5xx || 0);
  for (let i = 0; i < BUCKETS_MS.length; i++) row.buckets[i] = Number(hash[`b${i}`] || 0);
  row.maxMs = Object.entries(hash)
    .filter(([field]) => field.startsWith("max_ms_p"))
    .reduce((max, [, value]) => Math.max(max, Number(value) || 0), 0);
  return row;
};

const mergeRows = (a, b) => {
  const row = emptyRow();
  row.count = a.count + b.count;
  row.sumMs = a.sumMs + b.sumMs;
  row.over = a.over + b.over;
  row.s2xx = a.s2xx + b.s2xx;
  row.s4xx = a.s4xx + b.s4xx;
  row.s5xx = a.s5xx + b.s5xx;
  row.maxMs = Math.max(a.maxMs, b.maxMs);
  for (let i = 0; i < BUCKETS_MS.length; i++) row.buckets[i] = a.buckets[i] + b.buckets[i];
  return row;
};

/**
 * Vista del cluster. `hours` = 1 es la hora en curso; 2 añade la anterior, que
 * es lo que hace falta justo después de cambiar de hora, cuando la ventana en
 * curso tiene dos minutos de datos y no dice nada.
 */
const snapshot = async ({ redisFn = clientRedis, hours = 2, at = Date.now() } = {}) => {
  const client = await redisFn();
  const current = hourKey(at);
  const windows = [];
  for (let i = 0; i < Math.max(1, hours); i++) windows.push(current - i);

  const merged = new Map();
  const tenants = new Map();

  for (const hour of windows) {
    const keys = await client.keys(`metrics:h${hour}:route:*`);
    for (const key of keys) {
      const name = key.slice(`metrics:h${hour}:route:`.length);
      const row = parseRow(await client.hGetAll(key));
      merged.set(name, merged.has(name) ? mergeRows(merged.get(name), row) : row);
    }
    const tenantHash = await client.hGetAll(tenantHashKey(hour));
    for (const [tenant, count] of Object.entries(tenantHash || {})) {
      tenants.set(tenant, (tenants.get(tenant) || 0) + Number(count || 0));
    }
  }

  const endpoints = [...merged.entries()]
    .map(([name, row]) => ({
      endpoint: name,
      count: row.count,
      avgMs: row.count ? Math.round(row.sumMs / row.count) : 0,
      p50Ms: percentile(row, 0.5),
      p95Ms: percentile(row, 0.95),
      p99Ms: percentile(row, 0.99),
      maxMs: row.maxMs,
      overSlowest: row.over,
      status: { "2xx": row.s2xx, "4xx": row.s4xx, "5xx": row.s5xx },
      errorRate: row.count ? Number((row.s5xx / row.count).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const topTenants = [...tenants.entries()]
    .map(([tenant, count]) => ({ tenant, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  return {
    windowHours: windows.length,
    bucketsMs: BUCKETS_MS,
    totals: endpoints.reduce(
      (acc, e) => ({
        count: acc.count + e.count,
        s5xx: acc.s5xx + e.status["5xx"],
        s4xx: acc.s4xx + e.status["4xx"],
      }),
      { count: 0, s5xx: 0, s4xx: 0 }
    ),
    endpoints,
    topTenants,
    pending: { routes: routeStats.size, tenants: tenantStats.size },
  };
};

/** Arranca el volcado periódico. Idempotente y `unref`ed: no retiene el proceso. */
const startFlushing = ({ redisFn = clientRedis, intervalMs = FLUSH_MS } = {}) => {
  if (flushTimer) return flushTimer;
  flushTimer = setInterval(() => {
    flush({ redisFn }).catch(() => {});
  }, intervalMs);
  if (flushTimer.unref) flushTimer.unref();
  return flushTimer;
};

const stopFlushing = () => {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
};

/** Solo para tests. */
const _reset = () => {
  routeStats = new Map();
  tenantStats = new Map();
  flushing = false;
  stopFlushing();
};

module.exports = {
  record,
  flush,
  snapshot,
  startFlushing,
  stopFlushing,
  percentile,
  parseRow,
  BUCKETS_MS,
  MAX_ROUTES,
  MAX_TENANTS,
  OVERFLOW_ROUTE,
  OTHER_TENANT,
  _reset,
};
