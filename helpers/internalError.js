'use strict';

/**
 * La respuesta de un error interno, sin contárselo al cliente (SI-11,
 * APP-2026-013; 2026-11-17).
 *
 * Hasta hoy el patrón del repositorio era `msg: error.message`: el texto del
 * motor SQL, o del driver, viajaba al navegador. `POST /api/db_item/consulting-item`
 * con un cuerpo vacío respondía `{"msg":"syntax error at position 29"}`, que
 * dice el motor, la forma de la consulta y dónde se rompió. Es material de
 * reconocimiento gratis, y un evaluador lo encuentra en diez minutos.
 *
 * Aquí el detalle va al log —donde sirve para arreglarlo— y al cliente le llega
 * un mensaje genérico más el **id de la petición**, para que soporte pueda
 * cruzar lo que vio el usuario con la línea del log sin exponer nada.
 *
 * El id es el `X-Request-ID` que ya manda el dashboard y que registra
 * middlewares/requestLogger.js. Si no viene, se devuelve `null` en vez de
 * inventar uno: mejor que soporte sepa que no hubo id a que persiga uno que no
 * existe en los registros.
 *
 * Tres handlers lo usan hoy (los que midió el dashboard). El resto de la
 * campaña de APP-2026-013 consiste en traer más sitios aquí; por eso la firma
 * es la mínima que cubre los dos casos que hay: con y sin contexto extra.
 */

const logger = require('./logger');

const requestIdOf = (request) => {
  const raw =
    typeof request?.get === 'function'
      ? request.get('X-Request-ID')
      : request?.headers?.['x-request-id'];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || null;
};

/**
 * Registra el error con su contexto y responde 500 sin filtrar el detalle.
 *
 * @param {object} response  La respuesta de Express.
 * @param {object} request   La petición, para el id y la ruta.
 * @param {Error}  error     El error de verdad; va íntegro al log.
 * @param {object} [context] Lo que ayude a localizarlo (operación, tabla…).
 * @returns la respuesta, para poder hacer `return respondInternalError(...)`.
 */
const respondInternalError = (response, request, error, context = {}) => {
  const requestId = requestIdOf(request);
  logger.error(context.operation || 'internal error', {
    ...context,
    requestId,
    method: request?.method,
    path: request?.originalUrl?.split('?')[0] ?? request?.path,
    uid: request?.uid ?? null,
    error: error?.message,
    stack: error?.stack,
  });

  return response.status(500).json({
    ok: false,
    msg: 'Internal error. If it persists, contact support with the request id.',
    requestId,
  });
};

module.exports = { respondInternalError, requestIdOf };
