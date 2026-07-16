-- School track Phase 2
-- 1. Grade / homeroom on members (grouping + filters + bulk return by grade).
ALTER TABLE members_info
  ADD COLUMN grade VARCHAR(64) DEFAULT NULL,
  ADD COLUMN homeroom VARCHAR(128) DEFAULT NULL;

-- 2. History-preserving returns with condition tracking on the lease table.
--    return_status: 'returned' | 'lost' | 'damaged' (NULL while outstanding).
ALTER TABLE member_assigned_device_lease
  ADD COLUMN return_status VARCHAR(32) DEFAULT NULL,
  ADD COLUMN condition_note TEXT DEFAULT NULL,
  ADD COLUMN returned_date DATETIME DEFAULT NULL;
