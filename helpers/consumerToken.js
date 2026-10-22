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

function signConsumerToken({ consumerId, eventId, companyId, email, eventEnd }) {
  if (!consumerId || !eventId) throw new Error('consumerId and eventId are required');
  return jwt.sign(
    {
      typ: 'consumer',
      evt: String(eventId),
      cmp: companyId ? String(companyId) : null,
      // Para comparar con las rutas que la app identifica por email, sin ir a BD.
      eml: email ? String(email).trim().toLowerCase() : null,
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
    return { consumerId: p.sub, eventId: p.evt, companyId: p.cmp ?? null, email: p.eml ?? null, exp: p.exp };
  } catch {
    return null;
  }
}

/**
 * Token para un consumidor en un evento, con la compañía y la fecha de fin
 * sacadas de la BD. null si el evento no existe.
 */
async function issueConsumerToken(consumerId, eventId, { email, EventModel = Event } = {}) {
  const event = await EventModel.findById(eventId).select('company_id eventInfoDetail.dateEnd').lean();
  if (!event) return null;
  return signConsumerToken({
    consumerId,
    eventId,
    companyId: event.company_id,
    email,
    eventEnd: event.eventInfoDetail?.dateEnd,
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
  ttlFor,
};
