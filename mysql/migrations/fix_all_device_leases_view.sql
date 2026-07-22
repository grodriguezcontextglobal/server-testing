-- Corrected `all_device_leases` view for the PRODUCTION schema.
--
-- Supersedes the view defined in add_unified_lease_view_and_industries.sql, which was
-- authored against the demo/school-system branch and does NOT match prod:
--   * NONE of the three lease tables have a `lease_id` column in prod (they use composite PKs)
--   * member_assigned_device_lease.expected_return_date / assigned_date are VARCHAR (not dates)
--   * lease_customer_info has BOTH subscription_expected_return_date (date, canonical) and
--     subscription_expected_return_data (varchar, legacy) — we use the DATE one.
--
-- Design for prod:
--   * lease_key: synthetic id (lessee_type + composite key) since there is no lease_id.
--   * date columns CAST to DATETIME so downstream overdue checks are reliable across the
--     mixed source types (timestamp / date / varchar). Empty/invalid varchar -> NULL (safe).
--   * `outstanding` mirrors the per-track "still out" rule (no time function needed).
--     Overdue is computed by the caller (NOW() vs expected_return_date), not baked in here.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE VIEW all_device_leases AS
SELECT
  'staff' AS lessee_type,
  CONCAT_WS('-', 'staff', li.company_id, li.device_id, li.staff_member_id) AS lease_key,
  li.staff_member_id AS lessee_id,
  li.staff_admin_id  AS assigned_by,
  li.device_id,
  li.company_id,
  CAST(li.subscription_initial_date         AS DATETIME) AS assigned_date,
  CAST(li.subscription_expected_return_data AS DATETIME) AS expected_return_date,
  CAST(li.subscription_returned_date        AS DATETIME) AS returned_date,
  (li.active = 1 AND li.subscription_returned_date IS NULL) AS outstanding,
  li.location,
  NULL AS return_status,
  NULL AS condition_note
FROM lease_info li
UNION ALL
SELECT
  'consumer',
  CONCAT_WS('-', 'consumer', lci.company_id, lci.device_id, lci.consumer_member_id),
  lci.consumer_member_id,
  lci.staff_admin_id,
  lci.device_id,
  lci.company_id,
  CAST(lci.subscription_initial_date         AS DATETIME),
  CAST(lci.subscription_expected_return_date AS DATETIME),
  CAST(lci.subscription_returned_date        AS DATETIME),
  (lci.active = 1 AND lci.subscription_returned_date IS NULL),
  lci.location,
  NULL,
  NULL
FROM lease_customer_info lci
UNION ALL
SELECT
  'member',
  CONCAT_WS('-', 'member', madl.company_id, madl.device_id, madl.member_id),
  madl.member_id,
  madl.staff_member_id,
  madl.device_id,
  madl.company_id,
  CAST(madl.assigned_date        AS DATETIME),
  CAST(madl.expected_return_date AS DATETIME),
  CAST(madl.returned_date        AS DATETIME),
  (madl.returned = 0),
  madl.location,
  madl.return_status,
  madl.condition_note
FROM member_assigned_device_lease madl;
