'use strict';

const { PLATFORM_DOMAIN } = require('../helpers/platformAccess');

/**
 * Console de plataforma — esqueleto (M1).
 *
 * Aqui solo vive `GET /api/platform/me`. Las 20 rutas de lectura del console
 * son DC3 y se construyen encima de esta misma cadena, sin tocarla.
 *
 * Todas las respuestas de `/api/platform/*` usan la forma que pidio el
 * dashboard: `{ ok, data, page, limit, total }`, dinero en centimos enteros,
 * fechas en ISO UTC. `/me` no pagina, asi que lleva `ok` y `data` y nada mas.
 */

/**
 * Quien soy y que puedo ver.
 *
 * Que llegue aqui ya significa que `requirePlatformConsole` dijo que si, asi que
 * `platformAccess` es true por construccion: esta ruta NO vuelve a evaluar, solo
 * cuenta lo que el gate acaba de decidir. El valor de tenerla es que el console
 * pueda confirmar su acceso contra el servidor en vez de deducirlo del login
 * —que es lo que hace hoy—, y que ese chequeo deje su propia fila de auditoria.
 *
 * Deliberadamente no devuelve ni `super_user` ni roles de compañia: el console
 * es de solo lectura de plataforma y no tiene por que saber nada del poder de
 * escritura de la cuenta.
 */
const platformMe = async (request, response) => {
  return response.status(200).json({
    ok: true,
    data: {
      uid: request.platformActor?.id || request.uid,
      email: request.platformActor?.email || null,
      platformAccess: true,
      domain: PLATFORM_DOMAIN,
      // El gate exige las dos, asi que son true por haber llegado hasta aqui.
      // Se devuelven explicitas para que la pantalla no tenga que recordarlo.
      platformObserver: true,
      mfaEnabled: true,
      checkedAt: new Date().toISOString(),
    },
  });
};

module.exports = { platformMe };
