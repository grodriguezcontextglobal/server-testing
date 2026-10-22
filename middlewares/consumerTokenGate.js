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

const CLAIM_OF = { consumerId: 'consumerId', email: 'email', eventId: 'eventId', companyId: 'companyId' };

/** Campos del sujeto que no coinciden con el token. */
function mismatches(session, subject) {
  return Object.entries(subject ?? {})
    .filter(([key, value]) => CLAIM_OF[key] && value != null && value !== '')
    .filter(([key, value]) => session[CLAIM_OF[key]] == null || !same(session[CLAIM_OF[key]], value))
    .map(([key]) => key);
}

/**
 * @param {{ subject?: (req) => object, bootstrap?: boolean }} opts
 */
function consumerTokenGate({ subject = () => ({}), bootstrap = false } = {}) {
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

    let wrong;
    try {
      wrong = mismatches(session, subject(req));
    } catch {
      wrong = [];
    }
    if (wrong.length === 0) return next();

    const why = `el token no coincide con la petición (${wrong.join(', ')})`;
    if (!enforce) {
      logger.warn(`consumer token: ${why} (mode=warn, se deja pasar)`, { ...detail, consumer: session.consumerId });
      return next();
    }
    logger.warn(`consumer token: ${why}`, { ...detail, consumer: session.consumerId });
    return res.status(403).json({ ok: false, msg: 'This request does not belong to your account or event.' });
  };
}

module.exports = { consumerTokenGate, mismatches };
