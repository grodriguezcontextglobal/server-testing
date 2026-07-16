-- School track Phase 3
-- 1. Unified read view over the three parallel lease tracks. Until the
--    tables themselves are merged, this is the one place to query every
--    device lease regardless of who holds it.
--    lessee_type: 'staff' | 'consumer' | 'member'
--    NOTE: in lease_info, staff_member_id is the LESSEE; in
--    member_assigned_device_lease it is the ASSIGNER. The view normalizes
--    both meanings into lessee_id / assigned_by.
CREATE OR REPLACE VIEW all_device_leases AS
SELECT
  'staff' AS lessee_type,
  li.lease_id,
  li.staff_member_id AS lessee_id,
  li.staff_admin_id AS assigned_by,
  li.device_id,
  li.company_id,
  li.subscription_initial_date AS assigned_date,
  li.subscription_expected_return_data AS expected_return_date,
  li.subscription_returned_date AS returned_date,
  (li.active = 1 AND li.subscription_returned_date IS NULL) AS outstanding,
  li.location,
  NULL AS return_status,
  NULL AS condition_note
FROM lease_info li
UNION ALL
SELECT
  'consumer' AS lessee_type,
  lci.lease_id,
  lci.consumer_member_id AS lessee_id,
  lci.staff_admin_id AS assigned_by,
  lci.device_id,
  lci.company_id,
  lci.subscription_initial_date AS assigned_date,
  lci.subscription_expected_return_data AS expected_return_date,
  lci.subscription_returned_date AS returned_date,
  (lci.active = 1 AND lci.subscription_returned_date IS NULL) AS outstanding,
  lci.location,
  NULL AS return_status,
  NULL AS condition_note
FROM lease_customer_info lci
UNION ALL
SELECT
  'member' AS lessee_type,
  madl.lease_id,
  madl.member_id AS lessee_id,
  madl.staff_member_id AS assigned_by,
  madl.device_id,
  madl.company_id,
  madl.assigned_date,
  madl.expected_return_date,
  madl.returned_date,
  (madl.returned = 0) AS outstanding,
  madl.location,
  madl.return_status,
  madl.condition_note
FROM member_assigned_device_lease madl;

-- 2. Seed industry_list (mirrors the frontend industriesList.json keys so the
--    registration dropdown and the dynamic nav section agree on names).
INSERT IGNORE INTO industry_list (industry_name)
SELECT * FROM (
  SELECT 'Aerospace' UNION ALL SELECT 'Agriculture'
  UNION ALL SELECT 'Arts, Entertainment, and Recreation'
  UNION ALL SELECT 'Biotechnology' UNION ALL SELECT 'Construction'
  UNION ALL SELECT 'Creative Digital Services' UNION ALL SELECT 'Education'
  UNION ALL SELECT 'Energy' UNION ALL SELECT 'Finance and Insurance'
  UNION ALL SELECT 'Healthcare and Social Assistance' UNION ALL SELECT 'Hospitality'
  UNION ALL SELECT 'Information Technology' UNION ALL SELECT 'Language Services Provider'
  UNION ALL SELECT 'Manufacturing' UNION ALL SELECT 'Pharmaceuticals'
  UNION ALL SELECT 'Professional Services' UNION ALL SELECT 'Real Estate and Rental'
  UNION ALL SELECT 'Retail' UNION ALL SELECT 'Software applications'
  UNION ALL SELECT 'Software architecture consulting' UNION ALL SELECT 'Telecommunications'
  UNION ALL SELECT 'Transportation and Warehousing' UNION ALL SELECT 'Utilities'
  UNION ALL SELECT 'Wholesale Trade'
) seed(industry_name)
WHERE NOT EXISTS (
  SELECT 1 FROM industry_list il WHERE il.industry_name = seed.industry_name
);
