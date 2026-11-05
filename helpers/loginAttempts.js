/**
 * Bloqueo de cuenta por intentos fallidos de login (FedRAMP AC-7).
 *
 * Por cuenta (email), no por IP: el rate limit global de index.js es por IP y
 * deja 300 intentos cada 15 minutos contra la misma cuenta. Aquí, tras
 * LOGIN_MAX_ATTEMPTS fallos dentro de LOGIN_ATTEMPT_WINDOW_S, la cuenta queda
 * bloqueada LOGIN_LOCKOUT_S segundos. Cuentan la contraseña incorrecta y el
 * código MFA incorrecto; un login correcto pone el contador a cero.
 *
 * Vive en Redis para que el contador sea el mismo en todos los procesos.
 * Si Redis falla, el login NO se bloquea (fail-open): perder el bloqueo un rato
 * es mejor que dejar a todo el mundo fuera. Se registra el fallo.
 */
const logger = require("./logger");

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const maxAttempts = () => num(process.env.LOGIN_MAX_ATTEMPTS, 5);
const windowSeconds = () => num(process.env.LOGIN_ATTEMPT_WINDOW_S, 15 * 60);
const lockoutSeconds = () => num(process.env.LOGIN_LOCKOUT_S, 30 * 60);

const norm = (email) => String(email ?? "").trim().toLowerCase();
const failKey = (email) => `login_fail:${norm(email)}`;
const lockKey = (email) => `login_lock:${norm(email)}`;

/** Segundos que le quedan al bloqueo, o 0 si la cuenta no está bloqueada. */
const getLockoutRemaining = async (redis, email) => {
  try {
    const ttl = await redis.ttl(lockKey(email));
    return ttl > 0 ? ttl : 0;
  } catch (err) {
    logger.warn("login lockout check failed; allowing login", { err: err.message });
    return 0;
  }
};

/**
 * Suma un fallo. Devuelve { attempts, locked, retryAfter }.
 * Al llegar al máximo bloquea la cuenta y reinicia el contador.
 */
const recordLoginFailure = async (redis, email) => {
  try {
    const key = failKey(email);
    const attempts = await redis.incr(key);
    if (attempts === 1) await redis.expire(key, windowSeconds());
    if (attempts >= maxAttempts()) {
      const retryAfter = lockoutSeconds();
      await redis.set(lockKey(email), "1", { EX: retryAfter });
      await redis.del(key);
      return { attempts, locked: true, retryAfter };
    }
    return { attempts, locked: false, retryAfter: 0 };
  } catch (err) {
    logger.warn("login failure counter failed", { err: err.message });
    return { attempts: 0, locked: false, retryAfter: 0 };
  }
};

const clearLoginFailures = async (redis, email) => {
  try {
    await redis.del(failKey(email));
  } catch (err) {
    logger.warn("login failure counter reset failed", { err: err.message });
  }
};

module.exports = {
  getLockoutRemaining,
  recordLoginFailure,
  clearLoginFailures,
  maxAttempts,
  lockoutSeconds,
};
