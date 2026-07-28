-- Schema fix: the OTC consent lifecycle (commit 84841a7, "OTC consent lifecycle,
-- DOB, disclosure audit") reads/writes status/otc/otc_expires_at/requested_at/
-- requester_staff_id/responded_at/refused_at/response_ip/response_user_agent on
-- school_consent, but no migration ever added them — add_school_consent.sql only
-- created the base e-signature columns. Without this, requestConsent /
-- publicRetrieveConsent / publicRespondConsent fail with ER_BAD_FIELD_ERROR.
--
-- requester_staff_id is a Mongo AdminUser ObjectId (string), not a MySQL FK — same
-- convention as StaffActivityLog.staff_member_id.
-- Idempotency note: follows the existing raw-ALTER migration style in this repo.

ALTER TABLE school_consent
  ADD COLUMN status VARCHAR(16) DEFAULT NULL,
  ADD COLUMN otc VARCHAR(64) DEFAULT NULL,
  ADD COLUMN otc_expires_at DATETIME DEFAULT NULL,
  ADD COLUMN requested_at DATETIME DEFAULT NULL,
  ADD COLUMN requester_staff_id VARCHAR(64) DEFAULT NULL,
  ADD COLUMN responded_at DATETIME DEFAULT NULL,
  ADD COLUMN refused_at DATETIME DEFAULT NULL,
  ADD COLUMN response_ip VARCHAR(64) DEFAULT NULL,
  ADD COLUMN response_user_agent VARCHAR(255) DEFAULT NULL,
  ADD UNIQUE KEY uq_school_consent_otc (otc),
  ADD INDEX idx_school_consent_status_expiry (status, otc_expires_at);

-- Backfill: rows written before this migration only ever went through the
-- e-signature path (recordConsent), which always sets consented_at immediately.
-- Make the implicit 'agreed' state explicit so consentStatus/mutability checks
-- behave the same for pre-existing rows as for new ones.
UPDATE school_consent SET status = 'agreed' WHERE status IS NULL AND consented_at IS NOT NULL;
