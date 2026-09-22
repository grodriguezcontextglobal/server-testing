-- School consent / AUP records (Phase 3).
--
-- Captures a signed Acceptable Use Policy / device agreement for a student —
-- required for the education vertical (minors need guardian consent). One row per
-- (member, policy_type, policy_version); the unique key prevents duplicates.
-- guardian_id is the normalized guardian who signed (nullable = student/self or
-- the embedded primary). char(36) id via crypto.randomUUID. Idempotent DDL.

CREATE TABLE IF NOT EXISTS school_consent (
  id             CHAR(36)     NOT NULL,
  company_id     INT          NOT NULL,
  member_id      INT          NOT NULL,
  guardian_id    CHAR(36)     DEFAULT NULL,
  policy_type    VARCHAR(64)  NOT NULL DEFAULT 'AUP',
  policy_version VARCHAR(32)  NOT NULL DEFAULT '1',
  signer_name    VARCHAR(255) DEFAULT NULL,
  signer_email   VARCHAR(255) DEFAULT NULL,
  method         VARCHAR(32)  DEFAULT 'e-signature',
  consented_at   DATETIME     DEFAULT NULL,
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_school_consent (member_id, policy_type, policy_version),
  INDEX idx_consent_company (company_id),
  INDEX idx_consent_member (member_id)
);
