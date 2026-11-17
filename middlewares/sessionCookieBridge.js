'use strict';

/**
 * Puente de la sesión por cookie (fase 1, SC-23/AC-12; 2026-11-17).
 *
 * Nueve sitios del servidor leen la cabecera `x-token` (validate-jwt,
 * optionalJWT, checkTokenVersion, auditTrail, companyAuth…). Tocarlos uno a uno
 * para que además miren la cookie es mucha superficie para un cambio de
 * transporte, así que este middleware hace una sola cosa, una vez, antes de
 * todos ellos: si la petición NO trae `x-token` pero sí la cookie de sesión,
 * copia el token de la cookie a `request.headers['x-token']`. Todo lo que ya
 * existía sigue funcionando sin enterarse.
 *
 * La cabecera manda sobre la cookie: durante la fase 1 el dashboard puede
 * apagar su flag en cualquier momento y seguir mandando el token a mano.
 *
 * Antes de copiar nada, en los métodos que escriben, exige `X-CSRF-Token` y lo
 * compara con el claim `csrf` del propio token (ver helpers/sessionCookie.js).
 * Sin él, 403. Una página ajena puede provocar que el navegador mande la
 * cookie, pero no puede leer ese valor ni ponerlo en una cabecera.
 *
 * Un token de cookie que no verifica NO se copia y NO responde: se sigue sin
 * sesión, y quien decide el 401 es el middleware de siempre. Así un token
 * caducado da el mismo error que antes y no uno nuevo.
 */

const jwt = require('jsonwebtoken');
const logger = require('../helpers/logger');
const {
  CSRF_HEADER,
  SAFE_METHODS,
  cookieSessionEnabled,
  readSessionCookie,
  csrfMatches,
} = require('../helpers/sessionCookie');

const headerOf = (request, name) =>
  typeof request?.header === 'function' ? request.header(name) : request?.headers?.[name];

const createSessionCookieBridge = ({ verify = jwt.verify, log = logger } = {}) =>
  function sessionCookieBridge(request, response, next) {
    if (!cookieSessionEnabled()) return next();
    if (headerOf(request, 'x-token')) return next();

    const token = readSessionCookie(request);
    if (!token) return next();

    let payload;
    try {
      payload = verify(token, process.env.SECRET_JWT_SEED);
    } catch (_error) {
      return next();
    }

    const method = String(request.method || 'GET').toUpperCase();
    if (!SAFE_METHODS.has(method)) {
      const sent = headerOf(request, CSRF_HEADER);
      if (!csrfMatches(sent, payload?.csrf)) {
        log.warn('cookie session: CSRF token missing or does not match', {
          uid: payload?.uid ?? null,
          method,
          url: request.originalUrl ?? request.url ?? null,
          sent: sent ? 'present' : 'absent',
        });
        return response.status(403).json({
          ok: false,
          msg: 'Missing or invalid CSRF token',
        });
      }
    }

    request.headers = request.headers || {};
    request.headers['x-token'] = token;
    request.sessionFromCookie = true;
    return next();
  };

module.exports = {
  createSessionCookieBridge,
  sessionCookieBridge: createSessionCookieBridge(),
};
