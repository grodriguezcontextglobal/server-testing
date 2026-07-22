-- Per-company school settings (Phase 3 compliance).
--
-- Deliberately a SEPARATE table instead of ALTERing the core company_info table,
-- so a core-table migration can never break prod. The consent-enforcement flag
-- lives here; a MISSING row means OFF (fallback default) — reads never block
-- device assignment. Enforcement is therefore strictly opt-in per company.
-- Idempotent: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS company_school_settings (
  company_id             INT        NOT NULL,
  enforce_member_consent TINYINT(1) NOT NULL DEFAULT 0,
  created_at             TIMESTAMP  DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP  DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id)
);
