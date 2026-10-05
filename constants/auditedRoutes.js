'use strict';

/**
 * Rutas que el servidor registra en el audit trail (StaffActivityLog), con su
 * verbo y su modelo. Lo lee middlewares/auditTrail.js.
 *
 * La clave es `MÉTODO /ruta/montada`, tal como la compone resolveRoute
 * (baseUrl + route.path). test/auditedRoutes.test.js comprueba que cada clave
 * existe de verdad en los routers: una errata aquí sería una acción que deja de
 * registrarse sin que nadie lo note.
 *
 * QUÉ NO ESTÁ, A PROPÓSITO:
 *   - Consultas que van por POST (`consulting-*`, `retrieve-*`, `*-query`,
 *     `check-*`, listados y búsquedas). El método no decide; decide si cambia
 *     datos.
 *   - Rutas que ya registran a mano con logStaffActivity: login y
 *     force-logout, PATCH /api/admin/profile/:id y DELETE /api/admin/:id
 *     (controller/admin.js), create/edit/delete de /api/event
 *     (controller/event.js) y de /api/inventory (controller/inventory.js).
 *     Ponerlas aquí las duplicaría.
 *   - La fila SQL de un evento (`/api/db_event/new_event`, `update-event`,
 *     `DELETE /api/db_event/:id`): el evento ya queda registrado una vez por
 *     /api/event.
 *   - Envíos de correo (/api/nodemailer): son efecto de una acción que ya se
 *     registra, no una acción en sí.
 *   - El propio registro manual (POST /api/admin/activity-logs).
 *
 * Verbos y modelos: constants/activityVocabulary.js.
 */

const R = (action, target_model) => ({ action, target_model });

const AUDITED_ROUTES = {
  // ── Asignación de dispositivos a consumidores (pool del evento) ───────────
  'POST /api/receiver/receiver-assignation': R('ASSIGN', 'Device'),
  'POST /api/admin/receiver-assignation': R('ASSIGN', 'Device'),
  'POST /api/receiver/create-bulk-item-transaction-in-user': R('ASSIGN', 'Device'),
  'DELETE /api/receiver/remove-transaction/:id': R('UNASSIGN', 'Device'),
  'POST /api/receiver/receiver-returned-issue': R('RETURN', 'Device'),
  'PATCH /api/receiver/receiver-returned-issue/:id': R('UPDATE', 'Device'),
  'PATCH /api/receiver/transaction-all-items-returned-at-once': R('RETURN', 'Device'),
  'PATCH /api/receiver/transaction-return-all-items-in-pool': R('RETURN', 'Device'),
  'PATCH /api/receiver/receiver-update/:id': R('UPDATE', 'Device'),
  'PUT /api/receiver/receiver-update/:id': R('UPDATE', 'Device'),
  'PATCH /api/receiver/update-bulk-items-in-transaction': R('UPDATE', 'Device'),
  'POST /api/receiver/receivers-pool': R('CREATE', 'Device'),
  'POST /api/receiver/receivers-pool-bulk': R('CREATE', 'Device'),
  'PATCH /api/receiver/receivers-pool-update/:id': R('UPDATE', 'Device'),
  'PATCH /api/receiver/receivers-pool-update-bulk': R('UPDATE', 'Device'),
  'PATCH /api/receiver/update-bulk-items-in-pool': R('UPDATE', 'Device'),
  'DELETE /api/receiver/delete-device-pool/:id': R('DELETE', 'Device'),
  'DELETE /api/receiver/receiver-pool-device/:id': R('DELETE', 'Device'),
  'POST /api/receiver/delete-bulk-devices-pool': R('DELETE', 'Device'),

  // ── Inventario del evento ─────────────────────────────────────────────────
  'POST /api/db_event/event_device': R('ASSIGN', 'Inventory'),
  'POST /api/db_event/event_device_directly': R('ASSIGN', 'Inventory'),
  'POST /api/db_event/allocate-device-event': R('ASSIGN', 'Inventory'),
  'POST /api/db_event/allocate-device-container-event': R('ASSIGN', 'Inventory'),
  'POST /api/db_event/inserting-items-in-event-from-container': R('ASSIGN', 'Inventory'),
  'POST /api/db_event/reserve-items-for-event': R('RESERVE', 'Inventory'),
  'POST /api/db_event/lock-items-for-event': R('RESERVE', 'Inventory'),
  'POST /api/db_event/remove-reserved-items-for-event': R('RELEASE', 'Inventory'),
  'POST /api/db_event/remove-item-inventory-event': R('UNASSIGN', 'Inventory'),
  'POST /api/db_event/update-item-in-table-after-being-added-to-event-from-container': R('CHECK_OUT', 'Inventory'),
  'POST /api/db_event/update-status-item-based-on-event': R('UPDATE', 'Inventory'),
  'POST /api/db_event/device-final-status': R('UPDATE', 'Inventory'),
  'POST /api/db_event/device-final-status-refactored': R('UPDATE', 'Inventory'),
  'POST /api/db_event/confirm-item-return': R('RETURN', 'Inventory'),
  'POST /api/db_event/returning-item': R('RETURN', 'Inventory'),
  'POST /api/db_event/returning-item-refactored': R('RETURN', 'Inventory'),
  'POST /api/db_event/return-event-devices': R('RETURN', 'Inventory'),
  'POST /api/db_event/event_staff': R('ASSIGN', 'Staff'),
  'POST /api/db_record/inserting-record': R('ASSIGN', 'Inventory'),
  'POST /api/db_record/inserting-record-refactored': R('ASSIGN', 'Inventory'),
  'POST /api/db_record/removing-row-item-event-record': R('UNASSIGN', 'Inventory'),
  'POST /api/db_consumer_attending_event_record/new_consumer_event': R('ASSIGN', 'Consumer'),
  'POST /api/event/update-event-inventory-freshest-data': R('UPDATE', 'Event'),
  'PATCH /api/event/update-events': R('UPDATE', 'Event'),
  'POST /api/event/update-global-state': R('UPDATE', 'Event'),

  // ── Inventario de la compañía (SQL) ───────────────────────────────────────
  'POST /api/db_item/new_item': R('CREATE', 'Inventory'),
  'POST /api/db_item/bulk-item': R('IMPORT', 'Inventory'),
  'POST /api/db_item/bulk-item-alphanumeric': R('IMPORT', 'Inventory'),
  'POST /api/db_item/edit-item': R('UPDATE', 'Inventory'),
  'POST /api/db_item/delete-item': R('DELETE', 'Inventory'),
  'POST /api/db_item/delete-bulk-items': R('DELETE', 'Inventory'),
  'POST /api/db_item/delete-bulk-items-criteria': R('DELETE', 'Inventory'),
  'POST /api/db_item/item-out-warehouse': R('CHECK_OUT', 'Inventory'),
  'POST /api/db_item/return-event-devices': R('RETURN', 'Inventory'),
  'POST /api/db_item/returning-item-refactored': R('RETURN', 'Inventory'),
  'PUT /api/db_item/event-items': R('UPDATE', 'Shipment'),
  'PUT /api/db_item/event-items/bulk-update': R('UPDATE', 'Shipment'),
  'DELETE /api/db_item/event-items': R('DELETE', 'Shipment'),
  'POST /api/db_inventory/container-items': R('CREATE', 'Container'),
  'PUT /api/db_inventory/container/:container_item_id': R('UPDATE', 'Container'),
  'DELETE /api/db_inventory/container/:container_item_id': R('DELETE', 'Container'),
  'POST /api/db_inventory/update-large-data': R('UPDATE', 'Inventory'),
  'POST /api/db_inventory/update-location-sub-location': R('MOVE', 'Inventory'),
  'POST /api/db_company/insert-new-single-item': R('CREATE', 'Inventory'),
  'POST /api/db_company/delete-bulk-items': R('DELETE', 'Inventory'),
  'POST /api/db_company/update-all-items-in-inventory': R('UPDATE', 'Inventory'),
  'POST /api/db_company/update-content-in-container': R('UPDATE', 'Container'),
  'POST /api/db_company/update-group-items': R('UPDATE', 'Inventory'),
  'POST /api/db_company/update-items-based-on-serial-number': R('UPDATE', 'Inventory'),
  'POST /api/db_company/update-items-based-on-alphanumeric-serial-number': R('UPDATE', 'Inventory'),
  'POST /api/db_company/return-event-devices': R('RETURN', 'Inventory'),
  'POST /api/db_company/returning-leased-equipment': R('RETURN', 'Inventory'),
  'POST /api/db_company/categories/upsert': R('UPDATE', 'Category'),
  'DELETE /api/db_company/categories/:category_id': R('DELETE', 'Category'),
  'POST /api/db_company/groups/upsert': R('UPDATE', 'Group'),
  'DELETE /api/db_company/groups/:group_id': R('DELETE', 'Group'),
  'POST /api/item/create-item': R('CREATE', 'Item'),
  'PATCH /api/item/edit-item/:id': R('UPDATE', 'Item'),
  'DELETE /api/item/delete-item/:id': R('DELETE', 'Item'),

  // ── Locaciones y envíos ───────────────────────────────────────────────────
  'POST /api/db_location/locations': R('CREATE', 'Location'),
  'POST /api/db_location/locations/:id': R('DELETE', 'Location'),
  'PUT /api/db_location/locations/:id/inventory': R('MOVE', 'Inventory'),
  'POST /api/db_location/sub-location-path': R('CREATE', 'Location'),
  'POST /api/db_sub_location/sub-locations': R('CREATE', 'SubLocation'),
  'PUT /api/db_sub_location/sub-locations/:id': R('UPDATE', 'SubLocation'),
  'DELETE /api/db_sub_location/sub-locations/:id': R('DELETE', 'SubLocation'),
  'POST /api/company/assign-location': R('ASSIGN', 'Location'),
  'POST /api/db_shipment': R('CREATE', 'Shipment'),
  'PUT /api/db_shipment/:shipment_id': R('UPDATE', 'Shipment'),
  'DELETE /api/db_shipment/:shipment_id': R('DELETE', 'Shipment'),

  // ── Members, préstamos y colegio ──────────────────────────────────────────
  'POST /api/db_member/new-member': R('CREATE', 'Member'),
  'POST /api/db_member/bulk-members': R('IMPORT', 'Member'),
  'PATCH /api/db_member/update-member-info': R('UPDATE', 'Member'),
  'POST /api/db_member/delete-member-info': R('DELETE', 'Member'),
  'POST /api/db_member/new-member-assigned-device-lease': R('ASSIGN', 'Lease'),
  'POST /api/db_member/update-member-assigned-device-lease': R('UPDATE', 'Lease'),
  'POST /api/db_member/bulk-return': R('RETURN', 'Lease'),
  'POST /api/db_member/remove-row-lease-member': R('DELETE', 'Lease'),
  'POST /api/db_member/delete-member-assigned-device-lease': R('DELETE', 'Lease'),
  'POST /api/db_member/settle-member-fee': R('SETTLE', 'Fee'),
  'POST /api/db_lease/new-lease': R('CREATE', 'Lease'),
  'POST /api/db_lease/new-consumer-lease': R('CREATE', 'Lease'),
  'POST /api/db_lease/update-lease-info': R('UPDATE', 'Lease'),
  'POST /api/db_lease/update-consumer-lease-info': R('UPDATE', 'Lease'),
  'POST /api/db_lease/delete-lease-info': R('DELETE', 'Lease'),
  'POST /api/db_lease/delete-consumer-lease-info': R('DELETE', 'Lease'),
  'POST /api/lease/create-lease': R('CREATE', 'Lease'),
  'PATCH /api/lease/edit-lease/:id': R('UPDATE', 'Lease'),
  'DELETE /api/lease/delete-lease/:id': R('DELETE', 'Lease'),
  'POST /api/school/guardians/add': R('CREATE', 'Guardian'),
  'POST /api/school/consent/record': R('CREATE', 'Consent'),
  'POST /api/school/consent/request': R('SEND', 'Consent'),
  'POST /api/school/consent/resend': R('SEND', 'Consent'),
  'POST /api/school/consent/public/respond': R('RESPOND', 'Consent'),
  'POST /api/school/settings/consent-enforcement': R('UPDATE', 'Company'),
  'POST /api/school/student/export': R('EXPORT', 'Member'),
  'POST /api/school/student/erase': R('ERASE', 'Member'),

  // ── Consumidores ──────────────────────────────────────────────────────────
  'POST /api/db_consumer/new_consumer': R('CREATE', 'Consumer'),
  'DELETE /api/db_consumer/:id': R('DELETE', 'Consumer'),
  'POST /api/auth/new': R('CREATE', 'User'),
  'PATCH /api/auth/:id': R('UPDATE', 'User'),

  // ── Pagos y transacciones ─────────────────────────────────────────────────
  'POST /api/stripe/create-payment-intent': R('CHARGE', 'Transaction'),
  'POST /api/stripe/create-payment-intent-customized': R('CHARGE', 'Transaction'),
  'POST /api/stripe/create-payment-intent-subscription': R('CHARGE', 'Subscription'),
  'POST /api/stripe/payment-intents/:id/capture': R('CAPTURE', 'Transaction'),
  'POST /api/stripe/internal/payment-intents/:id/capture': R('CAPTURE', 'Transaction'),
  'POST /api/stripe/payment-intents/:id/cancel': R('CANCEL', 'Transaction'),
  'POST /api/stripe/internal/payment-intents/:id/cancel': R('CANCEL', 'Transaction'),
  'POST /api/stripe/refund': R('REFUND', 'Transaction'),
  'POST /api/stripe/internal/refund': R('REFUND', 'Transaction'),
  'POST /api/stripe/partial-refund': R('REFUND', 'Transaction'),
  'POST /api/stripe/internal/partial-refund': R('REFUND', 'Transaction'),
  'POST /api/stripe/payment_intents/:id/update-payment-method': R('UPDATE', 'Transaction'),
  'POST /api/stripe/payment_methods/:id/attach': R('UPDATE', 'Consumer'),
  'POST /api/stripe/customer': R('CREATE', 'Consumer'),
  'POST /api/stripe/save-transaction': R('CREATE', 'Transaction'),
  'POST /api/stripe/save-transaction-admin-dashboard': R('CREATE', 'Transaction'),
  'POST /api/stripe/save-transaction-template-no-regular-user': R('CREATE', 'Transaction'),
  'POST /api/stripe/stripe-transaction': R('CREATE', 'Transaction'),
  'POST /api/stripe/stripe-transaction-admin': R('CREATE', 'Transaction'),
  'POST /api/stripe/stripe-transaction-no-regular-user': R('CREATE', 'Transaction'),
  'DELETE /api/stripe/removing/:id': R('DELETE', 'Transaction'),
  'DELETE /api/stripe/remove-duplicate/:id': R('DELETE', 'Transaction'),
  'POST /api/stripe/accounts': R('CREATE', 'Company'),
  'POST /api/stripe/company-account-stripe/update': R('UPDATE', 'Company'),
  'POST /api/stripe/new-company-account': R('UPDATE', 'Company'),
  'POST /api/stripe/create-subscriptions': R('CREATE', 'Subscription'),
  'POST /api/stripe/create-subscriptions_no_trial': R('CREATE', 'Subscription'),
  'PATCH /api/stripe/updating-subscription/:id': R('UPDATE', 'Subscription'),
  'POST /api/stripe/payment-method/subscriptions/:id': R('UPDATE', 'Subscription'),
  'POST /api/stripe/cancel/subscriptions/:id': R('CANCEL', 'Subscription'),
  'DELETE /api/stripe/subscriptions/:id': R('CANCEL', 'Subscription'),
  'POST /api/db_stripe/new_stripe': R('CREATE', 'Consumer'),
  'POST /api/transaction/save-transaction': R('CREATE', 'Transaction'),
  'POST /api/transaction/save-transaction-admin-dashboard': R('CREATE', 'Transaction'),
  'POST /api/transaction/save-transaction-template-no-regular-user': R('CREATE', 'Transaction'),
  'PATCH /api/transaction/update-transaction/:id': R('UPDATE', 'Transaction'),
  'POST /api/transaction/update-multiple-documents': R('UPDATE', 'Transaction'),
  'POST /api/transaction/check-and-release-deposit-transactions': R('RELEASE', 'Transaction'),
  'DELETE /api/transaction/remove-duplicate-transaction/:id': R('DELETE', 'Transaction'),
  'POST /api/subscription/new_subscription': R('CREATE', 'Subscription'),
  'POST /api/subscription/new_subscription_no_trial': R('CREATE', 'Subscription'),
  'PATCH /api/subscription/update-subscription/:id': R('UPDATE', 'Subscription'),
  'POST /api/cash-report/create-cash-report': R('CREATE', 'CashReport'),
  'PATCH /api/cash-report/update-cash-report/:id': R('UPDATE', 'CashReport'),
  'POST /api/cash-report/remove-cash-report/:id': R('DELETE', 'CashReport'),

  // ── Documentos y firmas ───────────────────────────────────────────────────
  'POST /api/document/upload': R('UPLOAD', 'Document'),
  'POST /api/document/upload/xlsx': R('UPLOAD', 'Document'),
  'DELETE /api/document/:id': R('DELETE', 'Document'),
  'POST /api/document/new_folder': R('CREATE', 'Folder'),
  'PUT /api/document/folder/:id': R('UPDATE', 'Folder'),
  'DELETE /api/document/folder/:id': R('DELETE', 'Folder'),
  'POST /api/document/verification/staff_member/signed_document': R('CREATE', 'Verification'),
  'POST /api/document/verification/consumer_member/signed_document': R('CREATE', 'Verification'),
  'POST /api/document/verification/member/signed_document': R('CREATE', 'Verification'),
  'PATCH /api/document/verification/staff_member/signing_document': R('SIGN', 'Document'),
  'PATCH /api/document/verification/consumer_member/signing_document': R('SIGN', 'Document'),
  'PATCH /api/document/verification/member/signing_document': R('SIGN', 'Document'),
  'POST /api/company/provider-upload-document/:id': R('UPLOAD', 'Document'),
  'PATCH /api/company/update-signatures': R('UPDATE', 'Signature'),

  // ── Compañía y staff ──────────────────────────────────────────────────────
  'POST /api/company/new': R('CREATE', 'Company'),
  'PATCH /api/company/update-company/:id': R('UPDATE', 'Company'),
  'PATCH /api/company/update-company/register-process/:id': R('UPDATE', 'Company'),
  'POST /api/company/new_provider': R('CREATE', 'Provider'),
  'PATCH /api/company/update_provider/:id': R('UPDATE', 'Provider'),
  'POST /api/db_company/new_company': R('CREATE', 'Company'),
  'POST /api/db_company/update_company': R('UPDATE', 'Company'),
  'DELETE /api/db_company/:id': R('DELETE', 'Company'),
  'POST /api/db_staff/new_member': R('CREATE', 'Staff'),
  'POST /api/db_staff/company-staff': R('ASSIGN', 'Staff'),
  'PATCH /api/db_staff/company-staff': R('UPDATE', 'Staff'),
  'PATCH /api/db_staff/company-staff/role': R('UPDATE', 'Staff'),
  'PUT /api/db_staff/company-staff/scope': R('UPDATE', 'Staff'),
  'POST /api/admin/new_admin_user': R('CREATE', 'AdminUser'),
  'PATCH /api/admin/admin-user/:id': R('UPDATE', 'AdminUser'),
  'PATCH /api/staff/edit-admin/:id': R('UPDATE', 'AdminUser'),
  'PATCH /api/admin/update-password': R('UPDATE', 'AdminUser'),
  'POST /api/admin/mfa/verify': R('UPDATE', 'AdminUser'),
  'POST /api/admin/mfa/disable': R('UPDATE', 'AdminUser'),
  'POST /api/admin/logout': R('LOGOUT', 'AdminUser'),
  'POST /api/admin/manually_logout': R('LOGOUT', 'AdminUser'),
  'POST /api/admin/invalidate-all-sessions': R('FORCE_LOGOUT', 'AdminUser'),
};

module.exports = { AUDITED_ROUTES };
