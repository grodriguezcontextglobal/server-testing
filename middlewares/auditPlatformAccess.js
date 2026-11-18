'use strict';

const logger = require('../helpers/logger');
const { writePlatformAuditRow, DENY_REASONS } = require('../helpers/platformAuditLog');

/**
 * Registra en `platform_audit_log` UNA fila por peticion a `/api/platform/*`,
 * las denegadas incluidas (DC2; AU-2, AU-12).
 *
 * POR QUE INTERCEPTA LA RESPUESTA Y NO ESCUCHA 'finish'
 * ----------------------------------------------------
 * Lo natural seria `response.on('finish')`, y es lo que hace `auditTrail`. Aqui
 * no vale: 'finish' se dispara cuando la respuesta YA SALIO, asi que si la
 * escritura falla no queda nada que hacer salvo anotarlo — y el requisito es
 * fail-closed: una lectura del console que no deja constancia no se sirve.
 *
 * Por eso envuelve `response.json`: captura el cuerpo, escribe la fila, y solo
 * entonces deja salir la respuesta. Si el INSERT falla, lo que sale es un 503 y
 * el cuerpo original se descarta. El operador reintenta; el evaluador no se
 * encuentra un hueco.
 *
 * POR QUE SE MONTA ANTES DEL GATE
 * -------------------------------
 * El orden es `validateJWT -> checkTokenVersion -> auditPlatformAccess ->
 * requirePlatformConsole -> handler`, y no el que proponia el dashboard
 * (auditoria DESPUES del gate). Si fuera despues, una denegacion del gate
 * cortaria antes de llegar aqui y no dejaria fila — justo la fila que mas
 * importa.
 *
 * LO QUE DELIBERADAMENTE NO DEJA FILA: una peticion SIN sesion valida, que
 * `validateJWT` corta antes. Si se registrara, cualquiera en internet podria
 * llenar la tabla de auditoria dandole a `/api/platform/x` en un bucle, y una
 * tabla de auditoria que un anonimo puede inundar deja de ser evidencia. Esos
 * 401 quedan en el log HTTP. Con sesion valida y gate denegado, SI hay fila.
 *
 * NUNCA se guarda lo leido, solo QUE se leyo: ruta, parametros, estado y cuantos
 * registros salieron. `details` no lleva datos de cliente.
 */

/** Hoy el console no exporta (eso es DC3), pero el vocabulario ya lo contempla. */
const classifyAction = (request) => {
  const path = String(request.path || '');
  if (request.method === 'POST' && /\/exports?$/.test(path)) return 'export';
  const query = request.query || {};
  if (query.search || query.serial || query.q) return 'search';
  return 'view';
};

/**
 * La ruta con sus parametros SIN resolver (`/companies/:companyId/staff`), no la
 * url concreta: asi se puede agrupar por ruta, y el id concreto ya viaja en
 * `company_id` y en `details.params`.
 */
const describeResource = (request) => {
  const routePath = request.route?.path;
  const base = request.baseUrl || '';
  if (routePath) return `${request.method} ${base}${routePath === '/' ? '' : routePath}`;
  return `${request.method} ${String(request.originalUrl || base).split('?')[0]}`;
};

const countRecords = (body) => {
  if (Array.isArray(body?.data)) return body.data.length;
  if (Array.isArray(body?.items)) return body.items.length;
  return null;
};

const createAuditPlatformAccess = ({
  writeRow = writePlatformAuditRow,
  log = logger,
} = {}) => (request, response, next) => {
  let audited = false;
  const originalJson = response.json.bind(response);

  const buildRow = (body) => {
    const denial = request.platformDeny;
    const denied = Boolean(denial) || response.statusCode === 401 || response.statusCode === 403;
    return {
      at: new Date(),
      actorUserId: request.platformActor?.id || request.uid || null,
      actorEmail: request.platformActor?.email || null,
      action: classifyAction(request),
      // Solo de los parametros de ruta: el id de compañia que el console pidio.
      // Nunca del cuerpo ni de una cabecera, que el cliente controla.
      companyId: request.params?.companyId || null,
      resource: describeResource(request),
      details: {
        params: request.params || {},
        query: request.query || {},
        status: response.statusCode,
        records: countRecords(body),
        requestId: request.headers?.['x-request-id'] || null,
      },
      ip: request.ip || null,
      geo: null, // sin fuente de geolocalizacion todavia; la columna ya existe
      userAgent: request.headers?.['user-agent'] || null,
      result: denied ? 'denied' : 'allowed',
      reason: denied ? denial?.reason || DENY_REASONS.NO_SESSION : null,
    };
  };

  response.json = (body) => {
    if (audited) return originalJson(body);
    audited = true;

    writeRow(buildRow(body)).then(
      () => originalJson(body),
      (error) => {
        // Fail-closed. El cuerpo original se descarta a proposito: si no se pudo
        // registrar la lectura, la lectura no se entrega.
        log.error('platform_audit_log write failed — refusing the request', {
          error: error?.message,
          resource: describeResource(request),
          uid: request.uid || null,
          requestId: request.headers?.['x-request-id'] || null,
        });
        response.status(503);
        originalJson({
          ok: false,
          msg: 'Platform console unavailable: the access log could not be written.',
        });
      }
    );

    return response;
  };

  // Red de seguridad: si una respuesta sale por un camino que no es
  // `response.json` (un `send` de texto, el manejador de errores de Express),
  // no hay fila. No se puede impedir desde aqui, pero si se puede hacer RUIDOSO
  // en vez de silencioso, que es la diferencia entre un hueco que se ve y uno
  // que no.
  response.on('finish', () => {
    if (!audited) {
      log.error('platform console response left no audit row', {
        resource: describeResource(request),
        status: response.statusCode,
        uid: request.uid || null,
      });
    }
  });

  return next();
};

const auditPlatformAccess = createAuditPlatformAccess();

module.exports = {
  auditPlatformAccess,
  createAuditPlatformAccess,
  classifyAction,
  describeResource,
};
