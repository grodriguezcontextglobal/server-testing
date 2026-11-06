'use strict';

/**
 * Candado por clave en Redis (SET NX PX + borrado condicionado al token).
 *
 * Para los topes del plan (helpers/planLimits.js): contar y luego insertar no es
 * atómico, y dos altas simultáneas (o un import masivo contra un alta suelta)
 * pasarían las dos con el mismo conteo. Un candado de MySQL (GET_LOCK) no sirve
 * aquí: la base de producción es PlanetScale (Vitess) y la API corre en varios
 * procesos y workers, así que el candado tiene que ser externo a la conexión.
 * Redis ya se usa para lo mismo en la reserva de idempotencia y en los enlaces
 * de un solo uso (helpers/emailLinkToken.js).
 */

const crypto = require('node:crypto');

const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

class LockTimeoutError extends Error {
  constructor(key) {
    super(`could not acquire lock ${key}`);
    this.name = 'LockTimeoutError';
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @returns {Promise<() => Promise<void>>} la función que lo libera.
 */
async function acquireLock(
  key,
  {
    ttlMs = 60_000,
    waitMs = 15_000,
    retryMs = 50,
    clientFn = () => require('../database/cacheMemoryConfig').clientRedis(),
    sleep = defaultSleep,
    now = Date.now,
  } = {}
) {
  const client = await clientFn();
  const token = crypto.randomUUID();
  const deadline = now() + waitMs;

  for (;;) {
    const ok = await client.set(key, token, { NX: true, PX: ttlMs });
    if (ok) break;
    if (now() >= deadline) throw new LockTimeoutError(key);
    await sleep(retryMs);
  }

  let released = false;
  return async function release() {
    if (released) return;
    released = true;
    try {
      await client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
    } catch {
      // Si Redis falla al liberar, el TTL lo libera solo.
    }
  };
}

module.exports = { acquireLock, LockTimeoutError, RELEASE_SCRIPT };
