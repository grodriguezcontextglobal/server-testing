'use strict';

/**
 * PURE helpers for the member device-assignment consent gate (no I/O), so the
 * decision logic is unit-testable. The DB lookups (enforcement flag + which
 * members have consent) live in the controller; these functions just decide.
 */

// Given member rows (each with member_id + minor) and the set of member_ids that
// HAVE a recorded consent, return the minor members still missing consent.
const minorsMissingConsent = (memberRows = [], consentedIds = new Set()) => {
  const consented = consentedIds instanceof Set ? consentedIds : new Set(consentedIds || []);
  return (memberRows || []).filter(
    (m) => Number(m.minor) === 1 && !consented.has(m.member_id)
  );
};

module.exports = { minorsMissingConsent };
