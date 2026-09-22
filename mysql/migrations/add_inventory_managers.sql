-- Scoped inventory managers: a staff member can manage a location, a
-- sub-location (classroom/cabinet/shelf), an item category, or an item group.
-- scope_ref holds the location_id / sub_location_id (as string) or the
-- category/group NAME depending on scope_type. Managers are optional except
-- for parent locations (enforced as a soft warning in the UI).
CREATE TABLE IF NOT EXISTS inventory_managers (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT NOT NULL,
  staff_id BIGINT NOT NULL,
  scope_type VARCHAR(32) NOT NULL,   -- 'location' | 'sub_location' | 'category' | 'group'
  scope_ref VARCHAR(255) NOT NULL,   -- id (locations/sub_locations) or name (category/group)
  scope_label VARCHAR(255) DEFAULT NULL, -- display label snapshot
  assigned_by VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_manager_scope (company_id, staff_id, scope_type, scope_ref),
  KEY idx_im_company (company_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- collation must match locations/staff_member (utf8mb4_unicode_ci); the
-- MySQL 8 default utf8mb4_0900_ai_ci breaks the joins in listInventoryManagers.
