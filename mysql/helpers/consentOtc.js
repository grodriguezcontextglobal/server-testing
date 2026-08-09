'use strict';

const crypto = require('crypto');

/**
 * Generate a cryptographically secure one-time code for consent verification.
 * URL-safe base64, no padding.
 */
const generateOtc = () => {
  return crypto.randomBytes(32).toString('base64url');
};

/**
 * Hash a one-time code for storage.
 *
 * The raw code is a bearer credential: whoever holds it can record a guardian's
 * consent decision, which is the signature the education vertical relies on for
 * FERPA/COPPA. Storing it verbatim means read access to the table (or to a
 * backup) is enough to answer any outstanding consent request as the guardian.
 * Only the digest is persisted; the raw code exists in memory just long enough
 * to build the emailed link, and is verified by hashing the token presented.
 *
 * Plain SHA-256 rather than a slow KDF on purpose — the input is 32 bytes of
 * CSPRNG output, so there is no guessable secret to brute-force, and lookups
 * happen on an indexed column. Hex digest matches MySQL's SHA2(otc, 256), which
 * is what the backfill migration uses.
 */
const hashOtc = (otc) =>
  crypto.createHash('sha256').update(String(otc), 'utf8').digest('hex');

/**
 * Calculate OTC expiry date (7 days from now).
 */
const otcExpiresAt = (now = new Date()) => {
  const expires = new Date(now);
  expires.setDate(expires.getDate() + 7);
  return expires;
};

/**
 * Check if an OTC has expired.
 */
const isOtcExpired = (expiresAt, now = new Date()) => {
  if (!expiresAt) return true;
  return new Date(expiresAt) < new Date(now);
};

/**
 * Check if a consent status allows mutation (only pending can be mutated).
 */
const isConsentMutable = (status) => {
  return status === 'pending';
};

/**
 * Validate consent decision value.
 */
const isValidDecision = (decision) => {
  return decision === 'agreed' || decision === 'refused';
};

module.exports = { generateOtc, hashOtc, otcExpiresAt, isOtcExpired, isConsentMutable, isValidDecision };
