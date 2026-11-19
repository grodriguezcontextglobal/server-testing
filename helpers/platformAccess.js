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
 * COMPAÑIAS INTERNAS — las unicas en las que puede figurar un operador.
 *
 * De donde sale: el dashboard retiro su requisito de que los operadores no
 * tuvieran compañia (no se puede: dar de alta a alguien ES crearle una
 * membresia) y lo cambio por uno que si se puede cumplir — que la compañia sea
 * **interna**, nunca la de un cliente real. Eso quita el peligro de verdad, que
 * nunca fue "un operador tiene compañia" sino "un operador tiene la de un
 * cliente".
 *
 * POR QUE UNA LISTA DE IDS Y NO UNA REGLA: no hay ningun campo que diga que una
 * compañia es interna, y deducirlo del nombre —que empiece por "Test", que
 * contenga "ContextGlobal"— es una regla que deja de ser cierta el dia que
 * alguien registra un cliente que se llama parecido, y deja de serlo en
 * silencio. Una lista explicita es honesta sobre lo que es: algo que alguien
 * mantiene. Lo que cambia es que mantenerla se puede revisar.
 *
 * Y va AQUI, al lado de la lista de operadores, porque las dos se editan juntas:
 * dar de alta a un operador nuevo suele traer su compañia.
 *
 * LO QUE ESTA LISTA NO HACE: no la mira el gate. Comprobar la membresia en cada
 * peticion costaria una consulta a Mongo por request para proteger de algo que
 * no ocurre dentro de una sesion, y dejaria fuera a un operador en activo
 * porque alguien edito una compañia. Se mira al CONCEDER el flag, que es cuando
 * se decide. El precio de esa eleccion esta escrito: si a un operador ya
 * concedido lo meten despues en la compañia de un cliente, nada lo vuelve a
 * comprobar solo. `--candidates` lo enseña, y por eso hay que mirarlo.
 *
 * Vacia, no se puede conceder a nadie. Es deliberado: falla en cerrado, y la
 * primera concesion obliga a escribir aqui la compañia con su id delante.
 */
const PLATFORM_INTERNAL_COMPANIES = Object.freeze([
  // "Test Company 8/13/2023" — la compañia de pruebas interna. Leida de la base
  // el 2026-11-19: es la UNICA en la que figuran los dos operadores que existen
  // hoy (grodriguez@ y ccaminero@), y no figuran en ninguna otra. El nombre va
  // en el comentario porque se lee; lo que se compara es el id, que no cambia.
  '6a7d9ef28f33f83745aa54e2',
]);

const INTERNAL_COMPANIES = new Set(PLATFORM_INTERNAL_COMPANIES.map((id) => String(id).trim()));

const isInternalCompany = (companyId) => INTERNAL_COMPANIES.has(String(companyId || '').trim());

/**
 * Motivos por los que se RECHAZA UNA CONCESION. Deliberadamente separado de
 * `DENY_REASONS`, que es el vocabulario del gate: son dos decisiones distintas,
 * en dos momentos distintos, y mezclarlas dejaria poner en una fila del log un
 * motivo que el gate no puede producir.
 */
const GRANT_DENY_REASONS = Object.freeze({
  COMPANY_NOT_INTERNAL: 'company_not_internal',
});

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
  isInternalCompany,
  PLATFORM_DOMAIN,
  PLATFORM_CONSOLE_ALLOWLIST,
  PLATFORM_INTERNAL_COMPANIES,
  GRANT_DENY_REASONS,
  PLATFORM_ACCESS_FIELDS,
};
