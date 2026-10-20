'use strict';

/**
 * Token del QR de un recibo (2026-10-20).
 *
 * El recibo se imprime y el QR lo escanea alguien sin sesión (un padre, un
 * consumidor). Hasta ahora el QR llevaba solo el paymentIntent y la página leía
 * GET /api/transaction/transaction?paymentIntent=…, que devolvía la transacción
 * entera (nombre y email incluidos) a quien conociera o adivinara el id.
 *
 * Distinto del token de los correos (helpers/emailLinkToken.js) a propósito:
 *   - no es de un solo uso: un recibo se escanea muchas veces;
 *   - dura lo que dura el EVENTO más 30 días (decisión del 2026-10-20), no 5 días:
 *     el papel vive más que un correo.
 * Un tope duro (MAX_TTL_S) acota el daño de una fecha de fin de evento absurda.
 */

const jwt = require('jsonwebtoken');

const PURPOSE = 'receipt';
const GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TTL_S = 400 * 24 * 60 * 60;

const secret = () => `${process.env.SECRET_JWT_SEED}:receipt_link`;

/**
 * Hasta cuándo vale el QR: fin del evento + 30 días. Sin fecha de fin válida,
 * la de inicio; sin ninguna, 30 días desde ahora.
 * @returns {Date}
 */
function receiptExpiry({ dateEnd, dateBegin } = {}, now = new Date()) {
  const pick = [dateEnd, dateBegin].map((d) => (d ? new Date(d) : null)).find((d) => d && !Number.isNaN(d.getTime()));
  return new Date((pick ? pick.getTime() : now.getTime()) + GRACE_MS);
}

/**
 * @param {{ paymentIntent: string, company: string }} claims
 * @param {Date} expiresAt
 * @returns {string|null} null si ya caducó (el evento terminó hace más de 30 días)
 */
function signReceiptToken({ paymentIntent, company }, expiresAt, now = new Date()) {
  const ttl = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  if (ttl <= 0) return null;
  return jwt.sign({ purpose: PURPOSE, pi: paymentIntent, company }, secret(), { expiresIn: Math.min(ttl, MAX_TTL_S) });
}

/** Claims `{ pi, company, exp }` si el token es válido; si no, null. */
function readReceiptToken(token) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, secret());
    return payload.purpose === PURPOSE && payload.pi ? payload : null;
  } catch {
    return null;
  }
}

module.exports = { receiptExpiry, signReceiptToken, readReceiptToken, MAX_TTL_S };
