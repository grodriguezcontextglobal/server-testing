'use strict';

/**
 * Sesión por cookie, fase 1 (SC-23, AC-12; 2026-11-17).
 *
 * El token de sesión vive hoy en `localStorage` del dashboard, así que
 * cualquier XSS lo lee. La fase 1 lo mueve a una cookie `HttpOnly` SIN quitar
 * nada: el login sigue devolviendo `token` y el servidor sigue aceptando la
 * cabecera `x-token`. Así el dashboard puede encender y apagar su flag
 * (`VITE_APP_COOKIE_SESSION`) sin cortar el servicio.
 *
 *   fase 1 (esto)  cookie + header, los dos valen.
 *   fase 2         el dashboard deja de guardar el token.
 *   fase 3         el servidor deja de aceptar `x-token` y el login deja de
 *                  devolverlo.
 *
 * COOKIE_SESSION_MODE:
 *   `off` (por defecto) no se emite ninguna cookie. El `csrfToken` SÍ viaja en
 *     la respuesta del login: es inofensivo y permite encender la fase 1 en
 *     staging cambiando una sola variable, sin desplegar.
 *   `dual` emite la cookie y la acepta como sesión, con el header como
 *     alternativa.
 *
 * CSRF. Una cookie se manda sola en cada petición, así que una página ajena
 * podría disparar escrituras con la sesión del usuario. El antídoto es que el
 * navegador NO pueda adivinar un valor que la petición tiene que traer a mano:
 *   - el login genera `csrfToken` y lo devuelve en el cuerpo (el dashboard lo
 *     guarda en memoria y lo manda en `X-CSRF-Token`);
 *   - el MISMO valor viaja firmado dentro del token, en el claim `csrf`, así
 *     que comprobarlo no necesita ni Redis ni base de datos;
 *   - la cookie es `HttpOnly`: el claim no se puede leer desde JavaScript.
 * Solo se exige en métodos que escriben. Un GET no cambia estado.
 *
 * SameSite. En producción la cookie va `Secure` + `SameSite=None`, porque el
 * dashboard (admin.devitrak.net) y la API (db.devitrak.net) se sirven desde
 * hosts distintos y hay entornos de prueba en otro dominio. Fuera de
 * producción, `Lax` sin `Secure`, o el navegador la descarta en `http://localhost`.
 */

const crypto = require('crypto');
const { SESSION_MAX_SECONDS } = require('./jwt');

const COOKIE_NAME = 'dvk_session';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const mode = () => String(process.env.COOKIE_SESSION_MODE || 'off').toLowerCase();

/** ¿Se emite y se acepta la cookie? La fase 3 añadirá aquí su propio modo. */
const cookieSessionEnabled = () => mode() === 'dual';

const useSecure = () =>
  process.env.NODE_ENV === 'production' ||
  String(process.env.SESSION_COOKIE_SECURE || '').toLowerCase() === 'true';

/** Las opciones de la cookie de sesión. `maxAge` en ms, como pide Express. */
const sessionCookieOptions = () => {
  const secure = useSecure();
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
    maxAge: SESSION_MAX_SECONDS * 1000,
  };
};

/** Valor nuevo para el par `csrfToken` (cuerpo) / claim `csrf` (token). */
const newCsrfToken = () => crypto.randomBytes(32).toString('hex');

/**
 * El token de la cookie, sin depender de cookie-parser: no está montado, así
 * que `request.cookies` es `undefined` en producción.
 */
const readSessionCookie = (request) => {
  const raw =
    typeof request?.header === 'function'
      ? request.header('cookie')
      : request?.headers?.cookie;
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== COOKIE_NAME) continue;
    const value = part.slice(at + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
};

/** Emite la cookie si el modo lo permite. Devuelve si la emitió. */
const issueSessionCookie = (response, token) => {
  if (!cookieSessionEnabled() || !token) return false;
  response.cookie(COOKIE_NAME, token, sessionCookieOptions());
  return true;
};

/**
 * Borra la cookie. Sin mirar el modo: si el modo se apaga con sesiones abiertas,
 * el logout tiene que poder cerrarlas igual.
 */
const clearSessionCookie = (response) => {
  if (typeof response?.clearCookie !== 'function') return false;
  const { maxAge, ...options } = sessionCookieOptions();
  response.clearCookie(COOKIE_NAME, options);
  return true;
};

/** Comparación en tiempo constante de dos valores hex de la misma longitud. */
const csrfMatches = (sent, claim) => {
  if (typeof sent !== 'string' || typeof claim !== 'string') return false;
  if (sent.length === 0 || sent.length !== claim.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(claim));
};

module.exports = {
  COOKIE_NAME,
  CSRF_HEADER,
  SAFE_METHODS,
  cookieSessionEnabled,
  sessionCookieOptions,
  newCsrfToken,
  readSessionCookie,
  issueSessionCookie,
  clearSessionCookie,
  csrfMatches,
};
