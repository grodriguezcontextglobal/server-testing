'use strict';

// Filtro de User.find() a partir de lo que manda el cliente en /api/auth/users,
// /api/auth/user-query y /api/event/all-users-and-transactions-per-event.
//
// Antes el body o el query string iban tal cual a User.find(): un body como
// { email: { $ne: null } } (o uno vacío) devolvía todos los consumidores a
// cualquiera. Ahora solo se aceptan campos del modelo con valores simples, y
// hay dos carriles:
//   - staff con sesión válida: cualquier combinación de esos campos (vacío =
//     todos, como hasta ahora; lo usa el dashboard).
//   - sin sesión (app del consumidor, registro público a eventos): solo la
//     búsqueda exacta por email, y sin las notas internas de las compañías.
//
// Además, lo que llega desde el dashboard (admin.devitrak.net) se trata como
// staff: sin sesión válida es 401, no cae al carril público. La única excepción
// es POST /user-query, que la página pública /attendance-confirmation del
// dashboard llama sin sesión para buscar al consumidor por email. El Origin lo
// puede falsear cualquiera que no sea un navegador, así que esto no protege
// nada por sí solo (el carril público ya está acotado): sirve para que una
// sesión del dashboard caducada dé 401 en vez de respuestas recortadas.

const { isValidObjectId } = require('mongoose');
const AdminUser = require('../models/AdminUser');

const FILTERABLE = new Set([
  'name',
  'lastName',
  'email',
  'phoneNumber',
  'privacyPolicy',
  'category',
  'provider',
  'eventSelected',
  'groupName',
  'company_providers',
  'event_providers',
  'profile_picture',
]);

// Orígenes del dashboard de staff. STAFF_ORIGINS (separados por comas) los
// sustituye, p. ej. para añadir el localhost del dashboard en desarrollo.
const DEFAULT_STAFF_ORIGINS = ['https://admin.devitrak.net', 'https://admin-testing-dev.netlify.app'];

function isStaffOrigin(req) {
  const configured = process.env.STAFF_ORIGINS
    ? process.env.STAFF_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : DEFAULT_STAFF_ORIGINS;
  const origin = typeof req.header === 'function' ? req.header('origin') : req.headers?.origin;
  return Boolean(origin) && configured.includes(origin);
}

// Lo que no ve quien no tiene sesión: notas que el staff escribe del consumidor.
const PUBLIC_PROJECTION = '-notes';

class UserFilterError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

const PLAIN = new Set(['string', 'number', 'boolean']);

/**
 * @param {object|undefined} input  body, o el query string ya parseado.
 * @param {{ authenticated: boolean, sessionRequired?: boolean }} lane
 *   sessionRequired: sin sesión no hay carril público (petición del dashboard).
 * @returns {object|null} filtro seguro para User.find(), o null si sin sesión
 *   no pidió nada: la respuesta es una lista vacía, no todos los consumidores.
 *   No es 401 porque la app del consumidor llama GET /api/consumer/users sin
 *   filtro (DisplayQRCode.jsx) y un error cortaría lo que hace después.
 * @throws {UserFilterError} 400 si trae campos u operadores no permitidos,
 *   401 si sin sesión pide algo que no sea la búsqueda por email, o si la
 *   sesión era obligatoria.
 */
function buildUserFilter(input, { authenticated, sessionRequired = false }) {
  if (!authenticated && sessionRequired) {
    throw new UserFilterError(401, 'Staff session required');
  }
  const filter = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!FILTERABLE.has(key)) throw new UserFilterError(400, `Unsupported filter: ${key}`);
    if (!PLAIN.has(typeof value)) {
      throw new UserFilterError(400, `Filter ${key} must be a plain value`);
    }
    filter[key] = value;
  }

  if (!authenticated) {
    if (Object.keys(filter).length === 0) return null;
    const onlyEmail = Object.keys(filter).length === 1 && typeof filter.email === 'string';
    if (!onlyEmail || !filter.email.trim()) {
      throw new UserFilterError(401, 'Authentication required for this query');
    }
  }
  return filter;
}

// Query string → objeto. `params` puede ser null (sin "?"), y antes eso
// reventaba en params.split.
function parseQueryString(params) {
  return Object.fromEntries(new URLSearchParams(params ?? ''));
}

/**
 * ¿La petición trae una sesión de staff válida? Pensado para rutas con
 * optionalJWT: el token tiene que estar firmado (req.uid) y su tokenVersion
 * coincidir con la del AdminUser activo, igual que checkTokenVersion. Un token
 * de consumidor o uno de una sesión cerrada cuenta como "sin sesión".
 */
async function isStaffSession(req) {
  if (!req.uid || !isValidObjectId(req.uid)) return false;
  const admin = await AdminUser.findById(req.uid).select('tokenVersion active').lean();
  return Boolean(admin && admin.active !== false && admin.tokenVersion === req.tokenVersion);
}

module.exports = {
  buildUserFilter,
  isStaffOrigin,
  parseQueryString,
  isStaffSession,
  UserFilterError,
  PUBLIC_PROJECTION,
};
