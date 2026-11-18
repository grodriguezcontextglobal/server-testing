'use strict';

const { DENY_REASONS } = require('./platformAuditLog');

/**
 * Los cuatro requisitos del console de plataforma, en UN solo sitio (DC1 §2.2).
 *
 * Vive aqui y no dentro del gate porque hay DOS consumidores y tienen que decir
 * lo mismo:
 *
 *  1. `middlewares/requirePlatformConsole.js`, que deja pasar o no.
 *  2. `/api/admin/login`, que devuelve `platformAccess` para que el console no
 *     tenga que deducirlo.
 *
 * Si divergieran, el cliente enseñaria la entrada al console a alguien que el
 * servidor va a rechazar — un dia entero de "a mi me sale el boton y me da 403".
 *
 * NINGUNO de estos datos sale del token: los lee quien llama, de la base, en
 * cada peticion. Quitar el flag corta el acceso en la peticion siguiente.
 */

/**
 * Dominio del operador. Constante, no variable de entorno: una frontera de
 * seguridad que se puede ensanchar desde un `.env` se ensancha sola un martes.
 */
const PLATFORM_DOMAIN = 'devitrak.com';

/**
 * LISTA CERRADA de operadores del console (decision de Gustavo, 2026-11-18).
 *
 * Por que una lista y no solo el dominio: el 2026-11-18, al desplegar M1, la VM
 * enseño dos cosas a la vez. Primera, que **no existe ninguna cuenta
 * @devitrak.com**: el equipo entero esta en @contextglobal.com, asi que la regla
 * de dominio que pidio el dashboard no admitia a nadie. Segunda, que **dos
 * cuentas ya tenian `platform_observer`** —una de ContextGlobal y una de
 * gmail—, concedido para leer `/api/metrics`, que usa el mismo flag a traves de
 * `requirePlatformRead`.
 *
 * Es decir: el flag no identifica a un operador del console, porque ya estaba
 * repartido para otra cosa. La lista si.
 *
 * Y por eso se queda TAMBIEN la comprobacion de dominio, que con una lista
 * explicita podria parecer redundante: es la guardia de la lista. Si alguien
 * añade aqui un correo que no sea @devitrak.com, no entra — la edicion falla en
 * cerrado en vez de abrir una puerta en silencio.
 *
 * Quitarle a alguien el acceso al console es borrar su linea de aqui. No le
 * toca `platform_observer`, asi que no pierde `/api/metrics`: son dos accesos
 * distintos y ahora se revocan por separado.
 *
 * ANTES DE AÑADIR AQUI UN CORREO QUE NO SEA @devitrak.com: no basta con esta
 * lista. El dashboard tiene su propia comprobacion de dominio en el cliente
 * (`src/config/roles.js`), que es una segunda cerradura deliberada. Hoy no puede
 * desincronizarse —la comprobacion de dominio de abajo rechaza igual al que no
 * sea @devitrak.com, asi que haria falta cambiar TAMBIEN `PLATFORM_DOMAIN`—,
 * pero ese cambio hay que acordarlo con ellos y soltarlo en la misma release, o
 * el operador entra por el servidor y su propio cliente lo manda a `/` sin decir
 * nada. El test `toda entrada de la lista es del dominio de plataforma` lo
 * recuerda en el momento del merge.
 */
const PLATFORM_CONSOLE_ALLOWLIST = Object.freeze([
  'fstarmark@devitrak.com',
  'grodriguez@devitrak.com',
  // OJO con este: en @contextglobal.com la cuenta de la misma persona se
  // escribe `cacaminero@` (ver la lista de super_user en scripts/
  // super-user-access.js), y en @devitrak.com es `ccaminero@`. No son la misma
  // direccion y aqui vale solo la de devitrak. Corregido el 2026-11-19; hasta
  // entonces la lista tenia la grafia de contextglobal, que no admitia a nadie.
  'ccaminero@devitrak.com',
]);

const ALLOWLIST = new Set(PLATFORM_CONSOLE_ALLOWLIST.map((e) => e.trim().toLowerCase()));

const isAllowedOperator = (email) => ALLOWLIST.has(String(email || '').trim().toLowerCase());

/**
 * Dominio EXACTO, no sufijo. Asi no pasan `x@devitrak.com.evil.io`,
 * `x@devitrak.co` ni `x@sub.devitrak.com`.
 *
 * Y EXACTAMENTE UNA arroba: `x@evil.io@devitrak.com` tiene como dominio real
 * `devitrak.com` si se mira la ultima arroba, que es lo que haria un servidor de
 * correo, pero una direccion asi no se registra por accidente. Se rechaza. Eso
 * descarta tambien las direcciones con parte local entrecomillada
 * (`"a@b"@devitrak.com`), que son validas en el RFC y no existen en este
 * producto: preferimos negarle la entrada a un caso que no ocurre que abrirsela
 * a uno que ocurre a proposito.
 */
const isPlatformDomain = (email) => {
  const text = String(email || '').trim().toLowerCase();
  const parts = text.split('@');
  if (parts.length !== 2) return false;
  if (!parts[0]) return false;
  return parts[1] === PLATFORM_DOMAIN;
};

/**
 * @param {object|null} adminUser  Con al menos email, active, mfaEnabled,
 *                                 platform_observer.
 * @returns {{ok: boolean, reason: string|null}}
 *
 * El orden importa solo para QUE motivo se registra cuando falla mas de uno.
 * Va de lo mas general (la cuenta) a lo mas concreto (su segundo factor), que
 * es el orden en que lo arreglaria quien administra las cuentas.
 *
 * `super_user` NO sustituye a `platform_observer`, a proposito: el dueño de cada
 * compañia cliente tiene `super_user: true` en la suya (controller/
 * registration.js:128), asi que admitirlo aqui abriria el console —que lee datos
 * de TODOS los clientes— a cualquier cliente.
 */
const evaluatePlatformAccess = (adminUser) => {
  if (!adminUser) return { ok: false, reason: DENY_REASONS.UNKNOWN_ACCOUNT };
  if (adminUser.active === false) return { ok: false, reason: DENY_REASONS.INACTIVE_ACCOUNT };
  if (adminUser.platform_observer !== true) {
    return { ok: false, reason: DENY_REASONS.NOT_PLATFORM_OBSERVER };
  }
  if (!isPlatformDomain(adminUser.email)) {
    return { ok: false, reason: DENY_REASONS.WRONG_DOMAIN };
  }
  if (!isAllowedOperator(adminUser.email)) {
    return { ok: false, reason: DENY_REASONS.NOT_ON_ALLOWLIST };
  }
  if (adminUser.mfaEnabled !== true) return { ok: false, reason: DENY_REASONS.MFA_REQUIRED };
  return { ok: true, reason: null };
};

/** Los campos que hay que traer de Mongo para poder evaluar. */
const PLATFORM_ACCESS_FIELDS = 'email active mfaEnabled platform_observer';

module.exports = {
  evaluatePlatformAccess,
  isPlatformDomain,
  isAllowedOperator,
  PLATFORM_DOMAIN,
  PLATFORM_CONSOLE_ALLOWLIST,
  PLATFORM_ACCESS_FIELDS,
};
