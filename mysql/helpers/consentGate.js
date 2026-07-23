'use strict';

const { isUnder13 } = require('./ageCalc');

/**
 * PURE helpers for the member device-assignment consent gate (no I/O), so the
 * decision logic is unit-testable. The DB lookups (enforcement flag + which
 * members have consent) live in the controller; these functions just decide.
 */

// Given member rows (each with member_id, minor, date_of_birth) and the set of
// member_ids that HAVE a recorded consent, return members still missing consent.
const minorsMissingConsent = (memberRows = [], consentedIds = new Set(), now = new Date()) => {
  const consented = consentedIds instanceof Set ? consentedIds : new Set(consentedIds || []);
  return (memberRows || []).filter((m) => {
    if (Number(m.minor) === 1 && !consented.has(m.member_id)) return true;
    if (isUnder13(m.date_of_birth, now) === true && !consented.has(m.member_id)) return true;
    return false;
  });
};

// Returns true when a recorded consent does not satisfy the required policy version.
const isConsentStale = (memberConsentVersion, requiredVersion) => {
  if (!requiredVersion) return false;
  if (!memberConsentVersion) return true;
  return String(memberConsentVersion).trim() !== String(requiredVersion).trim();
};

module.exports = { minorsMissingConsent, isConsentStale };
