'use strict';

const crypto = require('crypto');
const logger = require('./logger');
const { SESSION_MAX_SECONDS } = require('./jwt');

/**
 * Estado de la sesión de staff en el servidor (FedRAMP A6 · AC-12, AC-2(5)).
 *
 * Hasta ahora una sesión era solo su JWT: cerrarla borraba la clave de Redis
 * `staff_session:<uid>`, pero el token seguía valiendo hasta caducar (12 h). Un
 * token copiado sobrevivía al logout, al force-logout y al reset de MFA.
 *
 * Ahora cada login abre una sesión con un id aleatorio (`sid`) que viaja en el
 * JWT y se guarda en `staff_session:<uid>`. checkTokenVersion exige:
 *
 *   - revocación: que el `sid` del token sea el de la sesión vigente. Borrar la
 *     clave (logout, force-logout, reset de MFA) o un login nuevo lo anulan.
 *   - inactividad: `staff_session:<uid>:idle` vive SESSION_IDLE_MINUTES y cada
 *     petición autenticada lo renueva. Si caduca, la sesión acabó.
 *
 * El dashboard ya cierra la sesión a los 15 min sin actividad del usuario
 * (useIdleSession, AC-11), pero solo mientras la pestaña está abierta. Este es
 * el respaldo para la sesión abandonada (navegador cerrado, token copiado): por
 * eso por defecto son 30 min y no 15. Con 15 en los dos lados, quien lee una
 * página o rellena un formulario largo sin llamar a la API, y para el dashboard
 * sigue activo, recibiría un 401.
 *
 * SESSION_MODE:
 *   warn     (por defecto) deja pasar y registra lo que habría rechazado.
 *   enforce  rechaza con 401.
 *   off      no mira nada.
 *
 * Si Redis no responde, se deja pasar (con aviso): tokenVersion sigue
 * comprobándose, y sin esto una caída de Redis tumbaría todo el dashboard.
 */

const sessionKey = (uid) => `staff_session:${uid}`;
const idleKey = (uid) => `staff_session:${uid}:idle`;

const mode = () => String(process.env.SESSION_MODE || 'warn').toLowerCase();

const idleSeconds = () => {
  const minutes = Number(process.env.SESSION_IDLE_MINUTES ?? 30);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0;
};

// Redis con la cola offline espera a reconectar en vez de fallar: sin tope,
// una caída dejaría colgada cada petición.
const REDIS_TIMEOUT_MS = 1500;
const withTimeout = (promise) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), REDIS_TIMEOUT_MS).unref?.()),
  ]);

const newSessionId = () => crypto.randomBytes(16).toString('hex');

/** Al hacer login: arranca el reloj de inactividad. La clave de sesión la escribe el login. */
async function touchIdle(redis, uid) {
  const seconds = idleSeconds();
  if (seconds) await redis.set(idleKey(uid), '1', { EX: seconds });
}

/**
 * Abre una sesión fuera del login (alta de cuenta con MFA_REQUIRED=false).
 * Devuelve el sid, o undefined si Redis no responde: el token sale sin sid y
 * se trata como uno anterior a A6.
 */
async function openStaffSession(getRedis, uid) {
  try {
    const sid = newSessionId();
    await withTimeout(
      getRedis().then(async (redis) => {
        await redis.set(sessionKey(uid), sid, { EX: SESSION_MAX_SECONDS });
        await touchIdle(redis, uid);
      })
    );
    return sid;
  } catch (error) {
    logger.warn('Could not open staff session', { uid, err: error.message });
    return undefined;
  }
}

/**
 * Comprueba la sesión de un token ya verificado. Devuelve null si vale, o el
 * motivo por el que no: 'no_sid' (token anterior a A6), 'revoked', 'idle'.
 * Si vale, renueva el reloj de inactividad.
 */
async function sessionProblem(redis, { uid, sid }) {
  if (!sid) return 'no_sid';
  const guard = process.env.DISABLE_SESSION_GUARD !== 'true';
  const seconds = idleSeconds();
  const [current, idle] = await Promise.all([
    guard ? redis.get(sessionKey(uid)) : null,
    seconds ? redis.get(idleKey(uid)) : '1',
  ]);
  // Sin el guard de sesión única (demo con cuentas compartidas) cada login
  // pisa el sid del anterior, así que la revocación por sid no aplica.
  if (guard && current !== sid) return 'revoked';
  if (!idle) return 'idle';
  if (seconds) await redis.set(idleKey(uid), '1', { EX: seconds });
  return null;
}

const MESSAGES = {
  no_sid: 'Session is no longer valid. Log in again.',
  revoked: 'Session has been terminated. Log in again.',
  idle: 'Session expired due to inactivity. Log in again.',
};

/**
 * Para checkTokenVersion. Devuelve el cuerpo del 401 si hay que rechazar, o
 * null para seguir.
 */
async function checkStaffSession(getRedis, { uid, sid }) {
  const m = mode();
  if (m === 'off') return null;
  let problem;
  try {
    // Un token sin sid no necesita Redis para decidir.
    problem = sid ? await withTimeout(getRedis().then((redis) => sessionProblem(redis, { uid, sid }))) : 'no_sid';
  } catch (error) {
    logger.warn('Staff session check skipped: Redis unavailable', { uid, err: error.message });
    return null;
  }
  if (!problem) return null;
  if (m !== 'enforce') {
    // Los tokens anteriores a A6 no traen sid y caducan solos en 12 h: no
    // hace falta un aviso por cada petición suya.
    if (problem !== 'no_sid') logger.warn('Staff session would be rejected (SESSION_MODE=warn)', { uid, reason: problem });
    return null;
  }
  return {
    ok: false,
    msg: MESSAGES[problem],
    sessionEnded: true,
    reason: problem,
  };
}

module.exports = {
  newSessionId,
  touchIdle,
  openStaffSession,
  sessionProblem,
  checkStaffSession,
  sessionKey,
  idleKey,
};
