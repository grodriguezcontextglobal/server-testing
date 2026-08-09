-- Store only the DIGEST of a guardian consent one-time code, never the code.
--
-- add_school_consent_otc.sql added `otc VARCHAR(64)` and looked links up with
-- `WHERE otc = ?`, so the raw bearer token sat in the table in clear text. That
-- token is what authorises a guardian's consent decision — the signature the
-- education vertical relies on for FERPA/COPPA — so read access to this table,
-- or to any backup or replica of it, was enough to answer every outstanding
-- consent request as the guardian.
--
-- SHA-256 hex, which is what mysql/helpers/consentOtc.js hashOtc() produces, so
-- the backfill below and the application agree byte for byte.
--
-- Existing outstanding links keep working: their hash is derived from the code
-- already on the row before the clear-text column is dropped.
--
-- Idempotency note: follows the existing raw-ALTER migration style in this repo.

ALTER TABLE school_consent
  ADD COLUMN otc_hash CHAR(64) DEFAULT NULL;

-- Derive the digest for every link issued before this migration.
UPDATE school_consent SET otc_hash = SHA2(otc, 256) WHERE otc IS NOT NULL;

-- Only now is the clear-text column redundant. Its unique key goes with it;
-- the replacement below enforces the same one-link-one-row guarantee.
ALTER TABLE school_consent
  DROP INDEX uq_school_consent_otc,
  DROP COLUMN otc;

ALTER TABLE school_consent
  ADD UNIQUE KEY uq_school_consent_otc_hash (otc_hash),
  ADD INDEX idx_school_consent_hash_expiry (otc_hash, otc_expires_at);
