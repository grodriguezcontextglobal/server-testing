-- School/member track hardening (Phase 1)
-- 1. Guardian/minor fields on members_info — previously only referenced by the
--    update whitelist but missing from the live schema, so they were silently
--    dropped on every write.
ALTER TABLE members_info
  ADD COLUMN minor TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN parent_guardian_first_name VARCHAR(255) DEFAULT NULL,
  ADD COLUMN parent_guardian_last_name VARCHAR(255) DEFAULT NULL,
  ADD COLUMN parent_guardian_email VARCHAR(255) DEFAULT NULL,
  ADD COLUMN parent_guardian_phone_number VARCHAR(255) DEFAULT NULL;

-- 2. A freshly created device lease must NOT be born "returned".
ALTER TABLE member_assigned_device_lease
  ALTER COLUMN returned SET DEFAULT 0;

-- 3. Member permissions (mirrors frontend src/config/roles.js F-02 block:
--    member CRU for root_admin/admin/sale_manager/event_manager, delete same).
INSERT IGNORE INTO permissions (resource, action) VALUES
  ('member','create'),('member','read'),('member','update'),('member','delete');

INSERT IGNORE INTO role_permissions
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.role_type IN ('root_admin','admin','sale_manager','event_manager')
    AND p.resource = 'member';
