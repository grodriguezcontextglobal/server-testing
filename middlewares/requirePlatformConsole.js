'use strict';

const AdminUser = require('../models/AdminUser');
const { DENY_REASONS } = require('../helpers/platformAuditLog');
const {
  evaluatePlatformAccess,
  PLATFORM_ACCESS_FIELDS,
  PLATFORM_DOMAIN,
} = require('../helpers/platformAccess');

/**
 * Gate de TODAS las rutas de `/api/platform/*` — el console de plataforma
 * (DC1; AC-2, AC-3, AC-6, IA-2).
 *
 * CINCO comprobaciones, no cuatro: flag, cuenta activa, dominio, **lista
 * cerrada de operadores** y MFA. La lista se añadio el 2026-11-18, al desplegar
 * M1 y descubrir que `platform_observer` ya estaba concedido a dos cuentas para
 * leer `/api/metrics` — o sea, que el flag no identificaba a un operador del
 * console. Ver helpers/platformAccess.js.
 *
 * POR QUE NO VALE `requirePlatformRead`, que ya existe
 * ---------------------------------------------------
 * `requirePlatformRead` admite `super_user` ademas de `platform_observer`, y ahi
 * esta el problema: **el dueño de cada compañia cliente tiene `super_user: true`
 * en su propia compañia** (se siembra al registrarla,
 * controller/registration.js:128). Para `/api/metrics` se acoto de otra forma;
 * para el console no sirve, porque el console lee datos de TODOS los clientes.
 * Un flag que cualquier cliente ya tiene no puede ser la puerta.
 *
 * Y al reves: `AdminUser.super_user` es el bypass TOTAL de
 * `authorizeMongoPermission` — escritura en todas las compañias. Concederlo para
 * que alguien pueda LEER un panel es al reves. De ahi que aqui `super_user` no
 * sustituya a nada: es `platform_observer` o no se entra.
 *
 * TODO SE LEE DE LA BASE EN CADA PETICION
 * ---------------------------------------
 * Nada de esto sale del token. Quitar el flag corta el acceso en la peticion
 * SIGUIENTE, sin esperar a que caduque la sesion ni tocar `tokenVersion`. Es el
 * caso 7 de B5 y es la razon de no cachear.
 *
 * PRERREQUISITO: `validateJWT` (pone `req.uid`) y `checkTokenVersion` corren
 * ANTES. Sin `validateJWT` este gate no queda mas estricto, queda INALCANZABLE
 * — 401 a todo, como le paso a `/api/metrics` hasta 8f9edab.
 *
 * DEJA RASTRO AUNQUE DENIEGUE: escribe `req.platformActor` y, si deniega,
 * `req.platformDeny`. `auditPlatformAccess` —que se monta ANTES que este gate,
 * precisamente para ver sus denegaciones— los lee al cerrar la respuesta. Una
 * denegacion es la fila que un evaluador busca primero.
 *
 * El criterio en si vive en `helpers/platformAccess.js`, compartido con el login
 * (que devuelve `platformAccess`): si divergieran, el console enseñaria su
 * entrada a quien el servidor va a rechazar.
 */

/**
 * Mensajes distintos por motivo, como ya hace `requirePlatformRead`: el 403 que
 * no dice QUE falta costo una tarde de averiguarlo. El console enseña un unico
 * mensaje al operador sea cual sea; el detalle es para el log y para quien
 * administra las cuentas.
 *
 * `unknown_account` e `inactive_account` responden "Forbidden" a secas a
 * proposito: ahi el mensaje le diria a quien prueba si la cuenta existe.
 */
const DENIALS = Object.freeze({
  [DENY_REASONS.UNKNOWN_ACCOUNT]: 'Forbidden',
  [DENY_REASONS.INACTIVE_ACCOUNT]: 'Forbidden',
  [DENY_REASONS.NOT_PLATFORM_OBSERVER]:
    'Forbidden: the platform console requires platform_observer',
  [DENY_REASONS.WRONG_DOMAIN]:
    `Forbidden: the platform console requires a ${PLATFORM_DOMAIN} account`,
  // No dice quien SI esta en la lista, ni cuantos son: eso es inventario de
  // cuentas privilegiadas y no se le cuenta a quien acaba de ser rechazado.
  [DENY_REASONS.NOT_ON_ALLOWLIST]:
    'Forbidden: this account is not a platform console operator',
  [DENY_REASONS.MFA_REQUIRED]:
    'Forbidden: the platform console requires MFA on your account',
});

const createRequirePlatformConsole = ({
  findAdminUser = (uid) => AdminUser.findById(uid).select(PLATFORM_ACCESS_FIELDS),
} = {}) => async (request, response, next) => {
  try {
    if (!request.uid) {
      // 401 con mensaje propio para que no se confunda con el de un token
      // invalido: aqui el token puede ser perfecto y faltar `validateJWT`.
      request.platformDeny = { reason: DENY_REASONS.NO_SESSION };
      return response.status(401).json({
        ok: false,
        msg: 'Unauthorized: no session identity on this request',
      });
    }

    const adminUser = await findAdminUser(request.uid);

    request.platformActor = {
      id: adminUser ? String(adminUser._id || adminUser.id || request.uid) : request.uid,
      email: adminUser?.email || null,
    };

    const verdict = evaluatePlatformAccess(adminUser);
    if (!verdict.ok) {
      request.platformDeny = { reason: verdict.reason };
      return response.status(403).json({ ok: false, msg: DENIALS[verdict.reason] || 'Forbidden' });
    }

    return next();
  } catch (error) {
    // Un fallo al COMPROBAR no es un permiso: se cierra. Y se marca como
    // denegada para que la fila de auditoria no la cuente como lectura servida.
    request.platformDeny = { reason: DENY_REASONS.UNKNOWN_ACCOUNT };
    return response.status(500).json({ ok: false, msg: 'Authorization check failed' });
  }
};

const requirePlatformConsole = createRequirePlatformConsole();

module.exports = {
  requirePlatformConsole,
  createRequirePlatformConsole,
  DENIALS,
};
