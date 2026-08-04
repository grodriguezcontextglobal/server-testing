-- consent_document_id: the Mongo Document _id (string, not a MySQL FK — same
-- convention as school_consent.requester_staff_id) for the consent policy
-- document a guardian must review before agreeing/declining. Company-level
-- setting, so it lives on company_school_settings alongside the other
-- consent-enforcement toggles.
-- Idempotency note: follows the existing raw-ALTER migration style in this repo.

ALTER TABLE company_school_settings
  ADD COLUMN consent_document_id VARCHAR(64) DEFAULT NULL;
