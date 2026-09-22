-- Normalized guardians for the school track (Phase 3).
--
-- members_info currently carries ONE embedded guardian
-- (minor, parent_guardian_first_name/last_name/email/phone_number). These tables
-- allow MULTIPLE guardians per student WITHOUT dropping the embedded fields — the
-- embedded guardian stays as the "primary" fallback (see mergeGuardians in
-- mysql/controllers/school.js); the normalized tables hold additional guardians.
--
-- char(36) UUID ids are generated in the app layer (crypto.randomUUID), matching
-- the staff_*_access convention. Idempotent: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS guardians (
  id            CHAR(36)     NOT NULL,
  company_id    INT          NOT NULL,
  first_name    VARCHAR(255) DEFAULT NULL,
  last_name     VARCHAR(255) DEFAULT NULL,
  email         VARCHAR(255) DEFAULT NULL,
  phone_number  VARCHAR(255) DEFAULT NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_guardians_company (company_id),
  INDEX idx_guardians_email (email)
);

-- Link table (many-to-many students <-> guardians). member_id references
-- members_info.member_id (int PK). Unique per (member, guardian) pair.
CREATE TABLE IF NOT EXISTS student_guardian (
  id           CHAR(36)    NOT NULL,
  company_id   INT         NOT NULL,
  member_id    INT         NOT NULL,
  guardian_id  CHAR(36)    NOT NULL,
  relationship VARCHAR(64) DEFAULT NULL,
  is_primary   TINYINT(1)  DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_guardian (member_id, guardian_id),
  INDEX idx_sg_member (member_id),
  INDEX idx_sg_guardian (guardian_id),
  INDEX idx_sg_company (company_id)
);
