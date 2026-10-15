'use strict';

/**
 * Token de un solo uso para enlaces que el servidor manda por correo a alguien
 * sin sesión (firma de contratos, confirmación de asistencia…).
 *
 * Mismo principio que helpers/passwordResetToken.js y helpers/invitationToken.js:
 * lo firma el servidor y solo viaja en el correo, así que quien lo presenta
 * demuestra que controla ese buzón. Lo que añade:
 *
 *   - Caducidad con tope duro de 5 días (MAX_TTL_S): quien llame con más se
 *     queda en 5.
 *   - Un solo uso: cada token lleva un `jti` y la acción final lo consume en
 *     Redis (SET NX, como la reserva de idempotencia). Solo la acción final:
 *     la página hace varias lecturas antes de firmar y no puede gastarlo en la
 *     primera.
 *
 * Si Redis falla, consume() no bloquea (devuelve 'unavailable'): quien lo usa
 * tiene que respaldarse en el estado ("¿ya está firmado?"), que es lo que
 * impide de verdad la doble acción.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { clientRedis } = require('../database/cacheMemoryConfig');

const MAX_TTL_S = 5 * 24 * 60 * 60;
const USED_PREFIX = 'emaillink:used:';

const secret = (purpose) => `${process.env.SECRET_JWT_SEED}:email_link:${purpose}`;

/**
 * @param {string} purpose  p. ej. 'contract_signing'. Un token de un propósito
 *   no vale para otro.
 * @param {object} claims   ids del sujeto; se comparan con la petición.
 * @param {{ ttlSeconds?: number }} [opts]  como mucho 5 días.
 */
function signEmailLinkToken(purpose, claims, { ttlSeconds = MAX_TTL_S } = {}) {
  const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), MAX_TTL_S);
  return jwt.sign(
    { ...claims, purpose, jti: crypto.randomUUID() },
    secret(purpose),
    { expiresIn: ttl },
  );
}

/** Claims (con jti y exp) si el token es de ese propósito y no caducó; si no, null. */
function readEmailLinkToken(purpose, token) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, secret(purpose));
    return payload.purpose === purpose && payload.jti ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Marca el token como usado.
 * @returns {Promise<'consumed'|'already_used'|'unavailable'>}
 */
async function consumeEmailLinkToken(claims) {
  const ttl = Math.max(1, (claims.exp ?? 0) - Math.floor(Date.now() / 1000));
  try {
    const client = await clientRedis();
    const set = await client.set(`${USED_PREFIX}${claims.jti}`, '1', { NX: true, EX: ttl });
    return set ? 'consumed' : 'already_used';
  } catch {
    return 'unavailable';
  }
}

/** Deshace consume() cuando la acción final no llegó a hacerse. */
async function releaseEmailLinkToken(claims) {
  try {
    const client = await clientRedis();
    await client.del(`${USED_PREFIX}${claims.jti}`);
  } catch {
    // Sin Redis no se marcó nada.
  }
}

module.exports = {
  MAX_TTL_S,
  signEmailLinkToken,
  readEmailLinkToken,
  consumeEmailLinkToken,
  releaseEmailLinkToken,
};
