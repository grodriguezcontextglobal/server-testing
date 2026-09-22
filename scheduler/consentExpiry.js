'use strict';

/**
 * Consent-OTC expiry sweep (school track).
 *
 * A pending consent's link stops working the moment `otc_expires_at` passes
 * (publicRetrieveConsent/publicRespondConsent already check this on read), but
 * the row itself stays status='pending' forever unless something marks it
 * 'expired'. That leaves compliance views (consentStatus, dashboards) unable to
 * tell "still waiting on the guardian" apart from "the link died and nobody
 * knows". This job closes that gap by flipping status to 'expired' once the
 * OTC has actually lapsed.
 *
 * Never touches 'agreed'/'refused' rows — isConsentMutable-style guard by
 * scoping the UPDATE to status='pending'.
 */
const getConnection = require("../mysql/database/config");
const logger = require("../helpers/logger");

const EXPIRE_QUERY = `
  UPDATE school_consent
     SET status = 'expired'
   WHERE status = 'pending'
     AND otc_expires_at IS NOT NULL
     AND otc_expires_at < NOW()`;

const runExpireConsents = async ({ getConnection: getConn = getConnection } = {}) => {
  const cn = getConn();
  const [result] = await cn.query(EXPIRE_QUERY);
  const expired = Number(result.affectedRows || 0);
  logger.info(`consent expiry sweep: ${expired} pending consent(s) marked expired`);
  return { expired };
};

module.exports = { runExpireConsents, EXPIRE_QUERY };
