'use strict';

/**
 * Token de sesión de la app del consumidor (app.devitrak.net) — fase A del
 * token de consumidor (2026-10-21).
 *
 * Dice QUIÉN (el consumidor), en QUÉ evento y de QUÉ compañía. Los tres van
 * firmados: el servidor nunca los toma de la petición cuando hay token.
 *
 * Por qué una clave propia: hasta hoy /auth/new devolvía un JWT firmado con
 * SECRET_JWT_SEED, la misma semilla que las sesiones de staff, y validateJWT lo
 * aceptaba. Cualquiera que se registrara como consumidor tenía un token que
 * pasaba por sesión en toda ruta protegida solo con validateJWT. Con otra
 * clave, un token de consumidor no verifica como sesión de staff, ni al revés.
 *
 * Caducidad: 7 días después del fin del evento, y nunca más de 30 días ni
 * menos de 1. El consumidor no tiene contraseña con la que volver a entrar; el
 * evento es lo que da sentido a la sesión.
 *
 * Nivel (`lvl`, decisión 2026-10-22):
 *   - 'verified': el consumidor demostró su buzón con el enlace del correo.
 *   - 'email': sin enlace. Solo en eventos con depósito (merchant), donde el
 *     depósito cubre el equipo: un consumidor existente entra con su email, y
 *     uno nuevo recibe este nivel al registrarse. Limitado al evento del token
 *     (ver middlewares/consumerTokenGate.js): para el perfil o los pagos hace
 *     falta 'verified'.
 *
 * Solo para la app del consumidor (decisión 2026-10-22): se emite, se canjea y
 * se lee únicamente en peticiones con Origin de CONSUMER_ORIGINS (por defecto
 * https://app.devitrak.net). El Origin lo pone el navegador y otro cliente
 * puede falsificarlo: esto acota dónde se usa el token, no lo sustituye.
 */

const jwt = require('jsonwebtoken');
const Event = require('../models/Event');

const AUDIENCE = 'devitrak-consumer';
const DAY = 24 * 60 * 60;
const MIN_TTL_S = 1 * DAY;
const MAX_TTL_S = 30 * DAY;
const AFTER_EVENT_S = 7 * DAY;

const secret = () =>
  process.env.CONSUMER_JWT_SECRET || `${process.env.SECRET_JWT_SEED}:consumer_session`;

const now = () => Math.floor(Date.now() / 1000);

// Orígenes de la app del consumidor. CONSUMER_ORIGINS (separados por comas) los
// sustituye, p. ej. para añadir el localhost de la app en desarrollo.
const DEFAULT_CONSUMER_ORIGINS = ['https://app.devitrak.net'];

function isConsumerOrigin(req) {
  const configured = process.env.CONSUMER_ORIGINS
    ? process.env.CONSUMER_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : DEFAULT_CONSUMER_ORIGINS;
  const origin = typeof req?.header === 'function' ? req.header('origin') : req?.headers?.origin;
  return Boolean(origin) && configured.includes(origin);
}

/** Para las rutas que solo existen para la app del consumidor: 403 desde otro origen. */
function requireConsumerOrigin(req, res, next) {
  if (isConsumerOrigin(req)) return next();
  return res.status(403).json({ ok: false, msg: 'This endpoint is only available to the Devitrak app.' });
}

/** Segundos de vida: hasta 7 días después del fin del evento, entre 1 y 30 días. */
function ttlFor(eventEnd) {
  const end = eventEnd ? Math.floor(new Date(eventEnd).getTime() / 1000) : NaN;
  const wanted = Number.isFinite(end) ? end + AFTER_EVENT_S - now() : MAX_TTL_S;
  return Math.min(Math.max(wanted, MIN_TTL_S), MAX_TTL_S);
}

const LEVELS = new Set(['verified', 'email']);

function signConsumerToken({ consumerId, eventId, companyId, email, eventName, level = 'verified', eventEnd }) {
  if (!LEVELS.has(level)) throw new Error(`unknown consumer token level: ${level}`);
  if (!consumerId || !eventId) throw new Error('consumerId and eventId are required');
  return jwt.sign(
    {
      typ: 'consumer',
      evt: String(eventId),
      cmp: companyId ? String(companyId) : null,
      // Para comparar con las rutas que la app identifica por email, sin ir a BD.
      eml: email ? String(email).trim().toLowerCase() : null,
      // Nombre del evento: algunas rutas de la app lo mandan en vez del id.
      evn: eventName ? String(eventName) : null,
      lvl: level,
    },
    secret(),
    { subject: String(consumerId), audience: AUDIENCE, expiresIn: ttlFor(eventEnd) },
  );
}

/** { consumerId, eventId, companyId, exp } si el token es válido; si no, null. */
function readConsumerToken(token) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const p = jwt.verify(token, secret(), { audience: AUDIENCE });
    if (p.typ !== 'consumer' || !p.sub || !p.evt) return null;
    if (!LEVELS.has(p.lvl)) return null;
    return {
      consumerId: p.sub,
      eventId: p.evt,
      companyId: p.cmp ?? null,
      email: p.eml ?? null,
      eventName: p.evn ?? null,
      level: p.lvl,
      exp: p.exp,
    };
  } catch {
    return null;
  }
}

/** Lo que el token necesita del evento, o null si no existe. */
async function loadTokenEvent(eventId, { EventModel = Event } = {}) {
  const event = await EventModel.findById(eventId)
    .select('company_id eventInfoDetail.dateEnd eventInfoDetail.eventName eventInfoDetail.merchant')
    .lean();
  if (!event) return null;
  return {
    id: String(eventId),
    companyId: event.company_id ? String(event.company_id) : null,
    eventName: event.eventInfoDetail?.eventName ?? null,
    eventEnd: event.eventInfoDetail?.dateEnd,
    merchant: event.eventInfoDetail?.merchant === true,
  };
}

/**
 * Token para un consumidor en un evento, con la compañía, el nombre y la fecha
 * de fin sacados de la BD. null si el evento no existe, o si se pide nivel
 * 'email' en un evento sin depósito.
 */
async function issueConsumerToken(consumerId, eventId, { email, level = 'verified', EventModel = Event } = {}) {
  const event = await loadTokenEvent(eventId, { EventModel });
  if (!event) return null;
  if (level === 'email' && !event.merchant) return null;
  return signConsumerToken({
    consumerId,
    eventId,
    companyId: event.companyId,
    email,
    eventName: event.eventName,
    level,
    eventEnd: event.eventEnd,
  });
}

module.exports = {
  AUDIENCE,
  isConsumerOrigin,
  requireConsumerOrigin,
  MAX_TTL_S,
  signConsumerToken,
  readConsumerToken,
  issueConsumerToken,
  loadTokenEvent,
  ttlFor,
};
