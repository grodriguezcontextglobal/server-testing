-- Phase D: Under-13 COPPA hardening.
-- date_of_birth enables dynamic under-13 calculation instead of a static flag.
--
-- Idempotency note: this follows the existing raw-ALTER migration style in this
-- repository. On MySQL versions without ADD COLUMN IF NOT EXISTS, run only once
-- or wrap these ALTER statements with information_schema checks in the deployer.

ALTER TABLE members_info
  ADD COLUMN date_of_birth DATE DEFAULT NULL;

-- Extend company_school_settings for opt-in under-13 consent enforcement and
-- consent re-collection when the required policy version changes.
ALTER TABLE company_school_settings
  ADD COLUMN enforce_under_13_consent TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN required_consent_policy_version VARCHAR(32) DEFAULT NULL;
