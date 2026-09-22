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
 * Hash an OTC for storage. The database keeps ONLY this value; the plaintext
 * code exists just long enough to be put in the guardian's email.
 *
 * Why hashed at all: the OTC is a bearer credential. Anyone holding it can read
 * a student's name, grade, DOB and guardian contact details, and can submit a
 * consent decision on their behalf. Stored in plaintext, a database dump, a
 * stray backup, or read access to one table is enough to impersonate every
 * pending guardian.
 *
 * Plain SHA-256 with no salt or stretching is deliberate here, and safe for
 * this case specifically: the input is 32 bytes of CSPRNG output, so it is not
 * guessable or brute-forceable the way a human-chosen password is. Salting
 * would also break lookup, since the code is found BY its hash. Do not copy
 * this approach for anything a person chooses.
 *
 * Output is 64 hex chars, which is exactly the width of the `otc` column, and
 * distinguishable from the 43-char base64url plaintext by length alone — that
 * is what makes the backfill migration idempotent.
 */
const hashOtc = (otc) =>
  crypto.createHash('sha256').update(String(otc)).digest('hex');

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

module.exports = {
  generateOtc,
  hashOtc,
  otcExpiresAt,
  isOtcExpired,
  isConsentMutable,
  isValidDecision,
};
