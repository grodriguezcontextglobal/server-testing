-- Fees for lost / damaged member devices (school track — frontend asks B1.1/B1.3).
--
-- WHY A SEPARATE TABLE instead of columns on member_assigned_device_lease:
--   1. A fee can be collected for a lease that never recorded one (a device
--      closed before fees existed). That is an INSERT, not an UPDATE of a lease
--      row that may not even carry the fee fields.
--   2. Schools need a second fee on the same device (lost charger, then lost
--      laptop). One fee per lease row cannot express that.
--   3. status/paid_amount/payment_intent/paid_at/collected_by_staff_id turn the
--      lease table into a billing table.
--
-- KEY: fees are matched by (company_id, member_id, device_id) — exactly the
-- triple both callers already hold — NOT by a lease id. The lease table has no
-- surrogate PK, and the charge modal can be opened standalone with no lease row.
-- Deliberately NOT unique on that triple: a device returned damaged, repaired
-- and re-assigned can legitimately accrue a second fee. "One outstanding fee per
-- triple" is enforced in the controller instead (it updates the open one).
--
-- fee_id is INT AUTO_INCREMENT rather than the CHAR(36) UUID used by the other
-- school tables: it is an opaque handle echoed back to the client, the contract
-- agreed with the frontend types it as a number, and no app-layer id generation
-- is needed here.
--
-- Amounts are DOLLARS (DECIMAL(10,2)). The Stripe layer speaks cents and
-- converts at its own boundary — cents must never reach this table.
--
-- Idempotent DDL: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS member_fees (
  fee_id                INT           NOT NULL AUTO_INCREMENT,
  company_id            INT           NOT NULL,
  member_id             INT           NOT NULL,
  device_id             INT           DEFAULT NULL,
  fee_amount            DECIMAL(10,2) DEFAULT NULL,
  fee_reason            VARCHAR(255)  DEFAULT NULL,
  -- what the device was declared as when the fee was raised: 'lost' | 'damaged'
  return_status         VARCHAR(32)   DEFAULT NULL,
  -- 'outstanding' | 'paid' | 'waived'
  status                VARCHAR(16)   NOT NULL DEFAULT 'outstanding',
  -- Stripe payment intent. UNIQUE is the idempotency guarantee for
  -- POST /db_member/settle-member-fee: a retry after a network timeout resolves
  -- to the same fee instead of settling twice. MySQL allows many NULLs in a
  -- UNIQUE index, so unpaid fees (and cash payments) are unaffected.
  payment_intent        VARCHAR(255)  DEFAULT NULL,
  paid_amount           DECIMAL(10,2) DEFAULT NULL,
  -- 'credit_card' | 'cash' | 'waived'
  payment_method        VARCHAR(32)   DEFAULT NULL,
  paid_at               DATETIME      DEFAULT NULL,
  -- SQL staff id taken from the JWT (request.sqlStaffId), never from the body
  collected_by_staff_id INT           DEFAULT NULL,
  created_at            TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (fee_id),
  UNIQUE KEY uq_member_fees_payment_intent (payment_intent),
  INDEX idx_member_fees_company_member (company_id, member_id),
  INDEX idx_member_fees_company_status (company_id, status),
  INDEX idx_member_fees_lease (company_id, member_id, device_id)
);
