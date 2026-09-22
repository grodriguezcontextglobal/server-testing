const crypto = require("crypto");
const logger = require("../helpers/logger");
const { clientRedis } = require("../database/cacheMemoryConfig");

// Cuánto vive una respuesta ya guardada: es la ventana en la que un reintento
// del cliente recibe la respuesta original en vez de volver a cobrar.
const TTL_MS = Number(process.env.PAYMENTS_MUTATION_IDEMPOTENCY_TTL_MS || 10 * 60 * 1000);

// Cuánto vive una RESERVA sin respuesta. Es mucho más corta a propósito: si el
// proceso muere entre reservar y responder, un reintento legítimo no puede
// quedar bloqueado los diez minutos de la respuesta.
const IN_FLIGHT_TTL_MS = Number(
  process.env.PAYMENTS_MUTATION_IDEMPOTENCY_INFLIGHT_TTL_MS || 30 * 1000
);

const KEY_PREFIX = "idem:mut:";

const stableStringify = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
};

const buildKey = (req) => {
  const headerKey = req.get("Idempotency-Key") || req.get("idempotency-key");
  if (headerKey) return `hdr:${String(headerKey).trim()}`;

  const signature = {
    method: req.method,
    path: req.route?.path || req.path || req.originalUrl,
    params: req.params || {},
    body: req.body || {},
  };

  return crypto.createHash("sha256").update(stableStringify(signature)).digest("hex");
};

// --- Almacenes -------------------------------------------------------------
//
// Los dos implementan el mismo contrato de tres operaciones:
//   reserve(key) -> null si la reserva es nuestra, o el registro vivo que ya había
//   commit(key, record) -> publica la respuesta definitiva
//   release(key) -> suelta una reserva que no llegó a producir respuesta

const memory = new Map();

const memoryStore = {
  name: "memory",
  async reserve(key) {
    const now = Date.now();
    const current = memory.get(key);
    if (current && now < current.expiresAt) return current;
    memory.set(key, { state: "in_flight", expiresAt: now + IN_FLIGHT_TTL_MS });
    return null;
  },
  async commit(key, record) {
    memory.set(key, { ...record, expiresAt: Date.now() + TTL_MS });
  },
  async release(key) {
    memory.delete(key);
  },
};

const redisStore = {
  name: "redis",
  async reserve(key) {
    const client = await clientRedis();
    const reserved = await client.set(
      `${KEY_PREFIX}${key}`,
      JSON.stringify({ state: "in_flight" }),
      { NX: true, PX: IN_FLIGHT_TTL_MS }
    );
    if (reserved) return null;

    const raw = await client.get(`${KEY_PREFIX}${key}`);
    // Puede haber caducado entre el SET NX y este GET. En esa rendija dejamos
    // pasar: falla abierto, que es como se comportaba el middleware entero antes.
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      logger.error(`idempotencyMutationCache: registro ilegible en Redis, se deja pasar: ${error.message}`);
      return null;
    }
  },
  async commit(key, record) {
    const client = await clientRedis();
    await client.set(`${KEY_PREFIX}${key}`, JSON.stringify(record), { PX: TTL_MS });
  },
  async release(key) {
    const client = await clientRedis();
    await client.del(`${KEY_PREFIX}${key}`);
  },
};

const useRedis = () =>
  (process.env.PAYMENTS_MUTATION_IDEMPOTENCY_STORE || "auto").toLowerCase() !== "memory" &&
  Boolean(process.env.REDIS_HOST && process.env.REDIS_PASSWORD);

let lastFallbackLogAt = 0;
const logFallback = (error) => {
  const now = Date.now();
  if (now - lastFallbackLogAt < 60 * 1000) return;
  lastFallbackLogAt = now;
  logger.error(
    "idempotencyMutationCache: Redis no responde; se degrada a memoria del proceso, " +
      `así que la protección deja de ser compartida entre procesos: ${error.message}`
  );
};

const withStore = async (fn) => {
  if (useRedis()) {
    try {
      return await fn(redisStore);
    } catch (error) {
      logFallback(error);
    }
  }
  return fn(memoryStore);
};

// Escrituras en vuelo, para que los tests puedan esperarlas sin dormir.
const pendingWrites = new Set();
const track = (promise) => {
  pendingWrites.add(promise);
  promise.finally(() => pendingWrites.delete(promise));
  return promise;
};

// --- Middleware ------------------------------------------------------------

const idempotencyMutationCache = async (req, res, next) => {
  const key = buildKey(req);

  let existing = null;
  try {
    existing = await withStore((store) => store.reserve(key));
  } catch (error) {
    // Ni Redis ni memoria: no bloqueamos un cobro por no poder reservar.
    logger.error(`idempotencyMutationCache: no se pudo reservar la clave, se deja pasar: ${error.message}`);
    return next();
  }

  if (existing && existing.state === "done") {
    return res.status(existing.statusCode).json(existing.body);
  }

  if (existing && existing.state === "in_flight") {
    // La misma operación está ejecutándose AHORA, puede que en otro proceso.
    // Antes las dos pasaban y se cobraba dos veces.
    return res.status(409).json({
      ok: false,
      msg: "A request with this idempotency key is already in progress",
    });
  }

  // La reserva es nuestra. Publicamos la respuesta al producirla, y soltamos la
  // reserva si la petición termina sin una respuesta que merezca guardarse.
  let committed = false;

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const statusCode = res.statusCode || 200;
    if (statusCode >= 200 && statusCode < 500) {
      committed = true;
      track(
        withStore((store) => store.commit(key, { state: "done", statusCode, body: payload }))
      ).catch((error) =>
        logger.error(`idempotencyMutationCache: no se pudo guardar la respuesta: ${error.message}`)
      );
    }
    return originalJson(payload);
  };

  if (typeof res.on === "function") {
    res.on("finish", () => {
      if (committed) return;
      track(withStore((store) => store.release(key))).catch((error) =>
        logger.error(`idempotencyMutationCache: no se pudo liberar la reserva: ${error.message}`)
      );
    });
  }

  return next();
};

module.exports = {
  idempotencyMutationCache,
  __idempotencyStore: memory,
  __idempotencyFlush: () => Promise.allSettled([...pendingWrites]),
};
