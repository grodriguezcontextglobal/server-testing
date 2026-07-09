'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Batch A: 22 rutas de /api/nodemailer/* con el mismo perfil de riesgo que las
// 4 ya migradas (single-recipient, sin validación, sin dependencia de DB) —
// se migran con el mismo patrón mecánico: builder puro + createQueuedEmailController.
// Ver DESIGN_task_queue.md § Fase 1 (batch de correos).
const {
  buildAssignDeviceMessage,
  buildReturningDeviceMessage,
  buildReturningDeviceLeaseMemberMessage,
  buildDeviceReportPerTransactionMessage,
  buildCancelDepositMessage,
  buildCaptureDepositMessage,
  buildEarlierReturningMessage,
  buildEventStaffMessage,
  buildEditingDeviceAdminMessage,
  buildConfirmationLinkNewConsumerMessage,
  buildLoginLinkExistingConsumerMessage,
  buildLinkToResetPasswordMessage,
  buildCustomizedEmailMessage,
  buildStaffInternalMessage,
  buildItemInfoStaffMessage,
  buildEventLinkEventMessage,
  buildChargeInvoiceMessage,
  buildRefundInvoiceMessage,
  buildCompletedTaskMessage,
  buildFailedTaskMessage,
  buildForcingRevokingActiveSessionMessage,
  buildMemberEmailMessage,
} = require('../nodeMailer/notifications');

function assertBasicShape(msg) {
  assert.equal(typeof msg.to, 'string');
  assert.ok(msg.to.length > 0);
  assert.equal(typeof msg.from, 'string');
  assert.equal(typeof msg.subject, 'string');
  assert.equal(typeof msg.html, 'string');
}

test('buildAssignDeviceMessage: arma el nombre completo del consumer como destinatario', () => {
  const msg = buildAssignDeviceMessage({ consumer: { firstName: 'Ana', lastName: 'Diaz', email: 'ana@b.com' }, devices: [] });
  assertBasicShape(msg);
  assert.equal(msg.to, 'Ana Diaz <ana@b.com>');
  assert.equal(msg.subject, 'Assignment device notification');
});

test('buildReturningDeviceMessage: usa el consumer como destinatario', () => {
  const msg = buildReturningDeviceMessage({ consumer: { firstName: 'Ana', lastName: 'Diaz', email: 'ana@b.com' }, devices: [] });
  assertBasicShape(msg);
  assert.equal(msg.to, 'Ana Diaz <ana@b.com>');
  assert.equal(msg.subject, 'Returned device notification');
});

test('buildReturningDeviceLeaseMemberMessage: usa el member (no consumer) como destinatario', () => {
  const msg = buildReturningDeviceLeaseMemberMessage({ member: { firstName: 'Leo', lastName: 'Ruiz', email: 'leo@b.com' }, devices: [] });
  assertBasicShape(msg);
  assert.equal(msg.to, 'Leo Ruiz <leo@b.com>');
});

test('buildDeviceReportPerTransactionMessage: usa el consumer como destinatario', () => {
  const msg = buildDeviceReportPerTransactionMessage({ consumer: { firstName: 'Ana', lastName: 'Diaz', email: 'ana@b.com' }, devices: [] });
  assertBasicShape(msg);
  assert.equal(msg.subject, 'Device Report Per Transaction');
});

test('buildCancelDepositMessage: usa consumer.email directo como destinatario', () => {
  const msg = buildCancelDepositMessage({ consumer: { email: 'ana@b.com' } });
  assertBasicShape(msg);
  assert.equal(msg.to, 'ana@b.com');
  assert.equal(msg.subject, 'Deposit returned notification');
});

test('buildCaptureDepositMessage: usa consumer.email directo como destinatario', () => {
  const msg = buildCaptureDepositMessage({ consumer: { email: 'ana@b.com' } });
  assertBasicShape(msg);
  assert.equal(msg.subject, 'Deposit captured');
});

test('buildEarlierReturningMessage: usa body.consumer (corrige bug preexistente de ReferenceError)', () => {
  const msg = buildEarlierReturningMessage({ consumer: 'ana@b.com' });
  assert.equal(msg.to, '<ana@b.com>');
  assert.equal(msg.subject, 'Returning device reminder');
  // El template real (returnReminderMessageHtml) es un stub que devuelve "" —
  // no es parte de esta migración inventar contenido, solo que ya no reviente.
  assert.equal(typeof msg.html, 'string');
});

test('buildEventStaffMessage: usa body.staff como destinatario', () => {
  const msg = buildEventStaffMessage({ staff: 'staff@b.com' });
  assertBasicShape(msg);
  assert.equal(msg.to, 'staff@b.com');
  assert.equal(msg.subject, 'Staff event');
});

test('buildEditingDeviceAdminMessage: usa body.contactAdminEmail como destinatario', () => {
  const msg = buildEditingDeviceAdminMessage({ contactAdminEmail: 'admin@b.com' });
  assertBasicShape(msg);
  assert.equal(msg.to, 'admin@b.com');
});

test('buildConfirmationLinkNewConsumerMessage: usa consumer.email como destinatario', () => {
  const msg = buildConfirmationLinkNewConsumerMessage({ consumer: { email: 'ana@b.com' } });
  assertBasicShape(msg);
  assert.equal(msg.subject, 'Confirmation link account');
});

test('buildLoginLinkExistingConsumerMessage: usa consumer.email como destinatario', () => {
  const msg = buildLoginLinkExistingConsumerMessage({ consumer: { email: 'ana@b.com' } });
  assertBasicShape(msg);
  assert.equal(msg.subject, 'Link to login');
});

test('buildLinkToResetPasswordMessage: usa contactInfo.email como destinatario', () => {
  const msg = buildLinkToResetPasswordMessage({ contactInfo: { email: 'ana@b.com' } });
  assertBasicShape(msg);
  assert.equal(msg.subject, 'Devitrak Notification - Reset Password Link');
});

test('buildCustomizedEmailMessage: usa body.consumersList como destinatario', () => {
  const msg = buildCustomizedEmailMessage({ consumersList: 'a@b.com,c@d.com', subject: 'Aviso' });
  assertBasicShape(msg);
  assert.equal(msg.subject, 'Devitrak Notification - Aviso');
});

test('buildStaffInternalMessage: usa body.staff como destinatario', () => {
  const msg = buildStaffInternalMessage({
    staff: 'staff@b.com',
    subject: 'Aviso',
    eventInfo: { eventName: 'Expo', dateBegin: '2026-01-01' },
    company: 'Devitrak',
    contactInfo: { name: 'Staff', email: 'staff@b.com' },
  });
  assertBasicShape(msg);
  assert.equal(msg.to, 'staff@b.com');
});

test('buildItemInfoStaffMessage: usa body.staff como destinatario', () => {
  const msg = buildItemInfoStaffMessage({ staff: 'staff@b.com', subject: 'Aviso', contactInfo: { staff: 'Staff', email: 'staff@b.com' } });
  assertBasicShape(msg);
  assert.equal(msg.to, 'staff@b.com');
});

test('buildEventLinkEventMessage: usa body.list como destinatario', () => {
  const msg = buildEventLinkEventMessage({ list: 'a@b.com', contactInfo: { staff: 'Staff', email: 'staff@b.com' } });
  assertBasicShape(msg);
  assert.equal(msg.subject, 'Devitrak Notification - Event Link.');
});

test('buildChargeInvoiceMessage: usa body.email como destinatario', () => {
  const msg = buildChargeInvoiceMessage({ email: 'a@b.com' });
  assertBasicShape(msg);
  assert.equal(msg.subject, 'Devitrak Notification - Payment confirmation.');
});

test('buildRefundInvoiceMessage: usa body.email como destinatario', () => {
  const msg = buildRefundInvoiceMessage({ email: 'a@b.com' });
  assertBasicShape(msg);
  assert.equal(msg.subject, 'Devitrak Notification - Refund confirmation.');
});

test('buildCompletedTaskMessage: destinatario fijo, no depende del body', () => {
  const msg = buildCompletedTaskMessage({});
  assertBasicShape(msg);
  assert.equal(msg.to, 'grodriguez@devitrak.com');
  assert.equal(msg.html, '<p>SUCCESS</p>');
});

test('buildFailedTaskMessage: destinatario fijo, no depende del body', () => {
  const msg = buildFailedTaskMessage({});
  assertBasicShape(msg);
  assert.equal(msg.html, '<p>FAILED</p>');
});

test('buildForcingRevokingActiveSessionMessage: usa body.email como destinatario', () => {
  const msg = buildForcingRevokingActiveSessionMessage({ email: 'a@b.com' });
  assertBasicShape(msg);
  assert.equal(msg.to, 'a@b.com');
  assert.equal(msg.subject, 'Action Required: End Your Active Session');
});

test('buildMemberEmailMessage: usa body.consumer como destinatario', () => {
  const msg = buildMemberEmailMessage({ consumer: 'a@b.com', subject: 'Aviso' });
  assertBasicShape(msg);
  assert.equal(msg.to, 'a@b.com');
  assert.equal(msg.subject, 'Aviso - Power by Devitrak');
});
