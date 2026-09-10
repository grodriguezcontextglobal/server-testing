'use strict';

/**
 * Readiness: "¿puede este proceso atender tráfico?", que no es lo mismo que
 * `/health`.
 *
 * Hoy `/health` (index.js) responde `200` con un `"standby"` fijado en el
 * código y sin tocar una sola dependencia, así que dice `ok` con MySQL caído.
 * Eso sirve como *liveness* —el proceso responde— y para nada más. Un
 * balanceador que use eso para decidir a quién manda tráfico manda tráfico a
 * un proceso que va a devolver 500 en todo.
 *
 * DOS DECISIONES que importan a 5.000 peticiones simultáneas:
 *
 * 1. CACHÉ CORTA (`TTL_MS`). Un endpoint de readiness que consulta las bases
 *    de datos en cada llamada es un vector de denegación de servicio: basta
 *    pedirlo en bucle para multiplicar la carga sobre MySQL. Con la caché, mil
 *    llamadas por segundo cuestan una comprobación cada `TTL_MS`.
 *
 * 2. TIMEOUT DURO POR DEPENDENCIA. Una Mongo colgada no debe colgar el
 *    readiness: un 503 rápido es información, y una petición que nunca
 *    responde hace que el balanceador tenga que decidir por timeout, que es
 *    varios segundos más tarde y con peticiones ya perdidas en el camino.
 *
 * CRÍTICO vs DEGRADADO, y el criterio es "¿puede este proceso servir la mayor
 * parte del tráfico?":
 *   - MySQL y Mongo son CRÍTICAS: sin ellas no hay casi ninguna respuesta útil,
 *     así que el proceso debe salir de rotación.
 *   - Redis y el worker de Go son DEGRADACIÓN: sin Redis se pierden cachés y
 *     la idempotencia, sin el worker fallan las operaciones masivas, pero el
 *     resto de la API funciona. Sacar el proceso de rotación por eso deja al
 *     cliente sin nada en vez de con casi todo.
 */

const mongoose = require("mongoose");
const getConnection = require("../mysql/database/config");
const { clientRedis } = require("../database/cacheMemoryConfig");

const TTL_MS = Number(process.env.READINESS_TTL_MS || 2_000);
const CHECK_TIMEOUT_MS = Number(process.env.READINESS_TIMEOUT_MS || 1_500);

const CRITICAL = ["mysql", "mongo"];

let cached = null;

/** Resuelve a `{ ok:false, error:'timeout' }` en vez de quedarse esperando. */
const withTimeout = async (label, promiseFactory, timeoutMs = CHECK_TIMEOUT_MS) => {
  const startedAt = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      promiseFactory(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, ms: Date.now() - startedAt, ...(result || {}) };
  } catch (error) {
    return { ok: false, ms: Date.now() - startedAt, error: error.message };
  } finally {
    clearTimeout(timer);
  }
};

const checkMysql = () =>
  withTimeout("mysql", async () => {
    const connection = getConnection();
    await connection.query("SELECT 1");
    return {};
  });

const checkMongo = () =>
  withTimeout("mongo", async () => {
    // readyState no sale a la red, así que no prueba nada por sí solo: un
    // socket puede seguir "connected" contra un servidor que ya no responde.
    // El ping sí, y es lo que decide.
    if (mongoose.connection.readyState !== 1) {
      throw new Error(`readyState=${mongoose.connection.readyState}`);
    }
    await mongoose.connection.db.admin().ping();
    return {};
  });

const checkRedis = () =>
  withTimeout("redis", async () => {
    const client = await clientRedis();
    await client.ping();
    return {};
  });

const checkGoWorker = ({ fetchImpl = fetch } = {}) =>
  withTimeout("goWorker", async () => {
    const host = process.env.GO_WORKER_HOST || "localhost";
    const port = process.env.GO_WORKER_PORT || 7453;
    const response = await fetchImpl(`http://${host}:${port}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { target: `${host}:${port}` };
  });

/**
 * Comprueba las cuatro dependencias en paralelo y resume.
 *
 * `checks` es inyectable para tests, y `force` salta la caché — que es lo que
 * quiere un operador mirando a mano, no lo que quiere un balanceador.
 */
const getReadiness = async ({ checks, force = false, now = Date.now } = {}) => {
  const at = now();
  if (!force && cached && at - cached.at < TTL_MS) {
    return { ...cached.value, cached: true };
  }

  const runners = checks || {
    mysql: checkMysql,
    mongo: checkMongo,
    redis: checkRedis,
    goWorker: checkGoWorker,
  };

  const names = Object.keys(runners);
  const results = await Promise.all(names.map((name) => runners[name]()));

  const detail = {};
  names.forEach((name, i) => { detail[name] = results[i]; });

  const failedCritical = CRITICAL.filter((name) => detail[name] && detail[name].ok === false);
  const degraded = names.filter((name) => !CRITICAL.includes(name) && detail[name] && detail[name].ok === false);

  const value = {
    ready: failedCritical.length === 0,
    status: failedCritical.length ? "unready" : degraded.length ? "degraded" : "ready",
    critical: CRITICAL,
    failedCritical,
    degraded,
    checks: detail,
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date(at).toISOString(),
  };

  cached = { at, value };
  return { ...value, cached: false };
};

const _resetCache = () => { cached = null; };

module.exports = {
  getReadiness,
  checkMysql,
  checkMongo,
  checkRedis,
  checkGoWorker,
  withTimeout,
  CRITICAL,
  TTL_MS,
  _resetCache,
};
