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

module.exports = { generateOtc, otcExpiresAt, isOtcExpired, isConsentMutable, isValidDecision };
