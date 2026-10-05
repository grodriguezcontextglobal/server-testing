'use strict';

// Canonical vocabulary for the staff activity log (frontend ask B2.2).
//
// `action` and `target_model` on StaffActivityLog are free text and STAY free
// text — a dozen existing call sites in admin.js / event.js / inventory.js write
// their own strings, and rejecting an unlisted verb would drop audit entries,
// which is the one thing an audit trail may never do. This file is the published
// list the report's filter dropdown is built from, not a gate.
//
// It exists because the fee charge had nowhere to belong and was logged as
// "CREATE a Fee" — which reads wrong in an export a school hands to a district.
// CHARGE / REFUND / WAIVE and the Fee / Lease / Member / Consent models close
// that gap.
//
// Adding a verb here does not change any write path; it makes the verb
// selectable in the report and documents it as the intended spelling.

const ACTIVITY_ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'FORCE_LOGOUT',
  'CREATE',
  'UPDATE',
  'DELETE',
  'ASSIGN',
  'UNASSIGN',
  'RETURN',
  'CHARGE',
  'REFUND',
  'WAIVE',
  'IMPORT',
  'EXPORT',
  // Audit trail del servidor (constants/auditedRoutes.js), 2026-10-05.
  'RESERVE',
  'RELEASE',
  'CHECK_OUT',
  'MOVE',
  'CAPTURE',
  'CANCEL',
  'SETTLE',
  'SEND',
  'RESPOND',
  'SIGN',
  'UPLOAD',
  'ERASE',
  'CLOSE',
  'RECONCILE',
  'ACCEPT',
  'CLEAR',
  'OPEN',
];

const ACTIVITY_TARGET_MODELS = [
  'AdminUser',
  'User',
  'Event',
  'Inventory',
  'Transaction',
  'Lease',
  'Member',
  'Guardian',
  'Consent',
  'Fee',
  'Verification',
  'Company',
  // Audit trail del servidor (constants/auditedRoutes.js), 2026-10-05.
  'Device',
  'Staff',
  'Consumer',
  'Item',
  'Container',
  'Category',
  'Group',
  'Location',
  'SubLocation',
  'Shipment',
  'Subscription',
  'CashReport',
  'Document',
  'Folder',
  'Signature',
  'Provider',
  'Email',
  'Invitation',
  'Terms',
  'Identifier',
  'StripeLink',
  'Image',
  'Post',
  'Article',
  'Feedback',
  'Task',
  'Cache',
  'StripeAccount',
];

module.exports = { ACTIVITY_ACTIONS, ACTIVITY_TARGET_MODELS };
