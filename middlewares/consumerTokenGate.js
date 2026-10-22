'use strict';

/**
 * Fase C del token de consumidor (2026-10-22): cada ruta que llama la app del
 * consumidor comprueba que el token (helpers/consumerToken.js, cabecera
 * `x-consumer-token`) es de QUIEN pide y del EVENTO y la COMPAÑÍA sobre los
 * que pide.
 *
 * Solo actúa en peticiones de la app del consumidor (CONSUMER_ORIGINS): el
 * dashboard y la sesión de staff siguen por sus carriles de siempre.
 *
 * Cada ruta declara `subject(req)`: los datos de la petición que tienen que
 * coincidir con el token — { consumerId, email, eventId, companyId }. Un campo
 * ausente (null/undefined) no se compara.
 *
 * CONSUMER_TOKEN_MODE:
 *   `warn` (por defecto) registra lo que enforce rechazaría y deja pasar. Es la
 *     lista que hay que leer antes de pasar a enforce, y la app todavía no
 *     manda el token (fase B).
 *   `enforce` responde 401 sin token válido y 403 si no coincide.
 *   `off` desactiva la comprobación.
 *
 * Token de nivel 'email' (entrada sin enlace en un evento con depósito,
 * decisión 2026-10-22): limitado al evento del token.
 *   - `verifiedOnly: true`: la ruta exige nivel 'verified' (perfil, pagos).
 *   - `eventScoped: true`: la petición tiene que nombrar el evento del token
 *     (eventId o eventName en el sujeto); sin evento, no vale con nivel 'email'.
 *   - `emailLevelBody: [...]`: con nivel 'email', el body solo puede traer esas
 *     claves (p. ej. unirse al evento, pero no cambiar nombre ni teléfono).
 * Lo que el nivel 'email' no permite responde 403 con `verificationRequired`,
 * para que la app pida el enlace del correo.
 *
 * `bootstrap: true` marca las rutas que la app llama ANTES de tener token
 * (cargar el evento, consultar el email, crear la cuenta): sin token pasan
 * siempre y no se registran; con token, se comprueba igual.
 *
 * Leer el log antes de pasar a enforce:
 *   Select-String -Path logs\combined*.log -Pattern "consumer token:"
 */

const logger = require('../helpers/logger');
const { isConsumerOrigin, readConsumerToken } = require('../helpers/consumerToken');

const mode = () => String(process.env.CONSUMER_TOKEN_MODE || 'warn').toLowerCase();

const tokenOf = (req) =>
  typeof req.header === 'function' ? req.header('x-consumer-token') : req.headers?.['x-consumer-token'];

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

const CLAIM_OF = {
  consumerId: 'consumerId',
  email: 'email',
  eventId: 'eventId',
  eventName: 'eventName',
  companyId: 'companyId',
};

const present = (value) => value != null && value !== '';

/** Por qué un token de nivel 'email' no basta para esta petición, o null. */
function emailLevelProblem(session, subject, req, { verifiedOnly, eventScoped, emailLevelBody }) {
  if (session.level !== 'email') return null;
  if (verifiedOnly) return 'la ruta exige el enlace del correo (nivel verified)';
  if (eventScoped && !present(subject?.eventId) && !present(subject?.eventName)) {
    return 'la petición no nombra el evento del token';
  }
  if (emailLevelBody) {
    const extra = Object.keys(req.body ?? {}).filter((k) => !emailLevelBody.includes(k));
    if (extra.length) return `campos que exigen el enlace del correo (${extra.join(', ')})`;
  }
  return null;
}

/** Campos del sujeto que no coinciden con el token. */
function mismatches(session, subject) {
  return Object.entries(subject ?? {})
    .filter(([key, value]) => CLAIM_OF[key] && present(value))
    .filter(([key, value]) => session[CLAIM_OF[key]] == null || !same(session[CLAIM_OF[key]], value))
    .map(([key]) => key);
}

/**
 * @param {{
 *   subject?: (req) => object,
 *   bootstrap?: boolean,
 *   verifiedOnly?: boolean,
 *   eventScoped?: boolean,
 *   emailLevelBody?: string[],
 * }} opts
 */
function consumerTokenGate({
  subject = () => ({}),
  bootstrap = false,
  verifiedOnly = false,
  eventScoped = false,
  emailLevelBody = null,
} = {}) {
  return function consumerTokenGate(req, res, next) {
    const currentMode = mode();
    if (currentMode === 'off' || !isConsumerOrigin(req)) return next();

    const raw = tokenOf(req);
    const session = readConsumerToken(raw);
    req.consumerSession = session;

    const detail = { route: req.originalUrl?.split('?')[0] || req.url, method: req.method, ip: req.ip };
    const enforce = currentMode === 'enforce';

    if (!session) {
      if (bootstrap) return next();
      const reason = raw ? 'token inválido o caducado' : 'sin token';
      if (!enforce) {
        logger.warn(`consumer token: ${reason} (mode=warn, se deja pasar)`, detail);
        return next();
      }
      logger.warn(`consumer token: ${reason}`, detail);
      return res.status(401).json({ ok: false, msg: 'Sign in again to continue.' });
    }

    let subj;
    try {
      subj = subject(req) ?? {};
    } catch {
      subj = {};
    }
    const wrong = mismatches(session, subj);
    const levelProblem = wrong.length
      ? null
      : emailLevelProblem(session, subj, req, { verifiedOnly, eventScoped, emailLevelBody });
    if (wrong.length === 0 && !levelProblem) return next();

    const why = levelProblem
      ? `token de nivel email: ${levelProblem}`
      : `el token no coincide con la petición (${wrong.join(', ')})`;
    if (!enforce) {
      logger.warn(`consumer token: ${why} (mode=warn, se deja pasar)`, { ...detail, consumer: session.consumerId });
      return next();
    }
    logger.warn(`consumer token: ${why}`, { ...detail, consumer: session.consumerId });
    if (levelProblem) {
      return res.status(403).json({
        ok: false,
        msg: 'Open the sign-in link sent to your email to continue.',
        verificationRequired: true,
      });
    }
    return res.status(403).json({ ok: false, msg: 'This request does not belong to your account or event.' });
  };
}

module.exports = { consumerTokenGate, mismatches };
