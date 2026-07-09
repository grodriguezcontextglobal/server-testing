'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Batch B: 8 rutas de /api/nodemailer/* que validan la entrada (400 si faltan
// campos) antes de enviar. Usan el hook `validate` de createQueuedJobController
// (helpers/queuedController.js) para que esos 400 NO se conviertan en 500 al
// encolar. Ver DESIGN_task_queue.md § Fase 1 (batch de correos).
const {
  buildLostDeviceFeeMessage,
  validateLostDeviceFee,
  buildLiabilityContractMemberMessage,
  validateLiabilityContractMember,
  buildLiabilityContractConsumerMessage,
  validateLiabilityContractConsumer,
  buildLiabilityContractStaffMessage,
  validateLiabilityContractStaff,
  buildTermsAndConditionsAcceptanceMessage,
  validateTermsAndConditionsAcceptance,
  buildDocumentSigningCompletionMessages,
  validateDocumentSigningCompletion,
  buildConsumerDocumentSigningCompletionMessages,
  validateConsumerDocumentSigningCompletion,
  buildConsumerLeaseEndedDeviceReturnedMessage,
  validateConsumerLeaseEndedDeviceReturned,
} = require('../nodeMailer/notifications');

// ─── lostDeviceFeeCollectedNotification ──────────────────────────────────────

test('validateLostDeviceFee: rechaza si normalizeLostFeePayload no resuelve un email', () => {
  const rejection = validateLostDeviceFee({});
  assert.equal(rejection.status, 400);
  assert.equal(rejection.body.ok, false);
});

test('validateLostDeviceFee: aprueba cuando hay consumerEmail resuelto', () => {
  assert.equal(validateLostDeviceFee({ consumer: { email: 'a@b.com' } }), null);
});

test('buildLostDeviceFeeMessage: usa el email normalizado como destinatario', () => {
  const msg = buildLostDeviceFeeMessage({ consumer: { email: 'a@b.com' }, company: 'Devitrak' });
  assert.equal(msg.to, 'a@b.com');
  assert.match(msg.subject, /Lost device fee receipt/);
});

// ─── liabilityContractMemberNotification ─────────────────────────────────────

test('validateLiabilityContractMember: rechaza sin member.email/name', () => {
  assert.equal(validateLiabilityContractMember({}).status, 400);
});

test('validateLiabilityContractMember: rechaza sin contract_list', () => {
  const body = { member: { name: 'M', email: 'm@b.com' }, contract_list: [] };
  assert.equal(validateLiabilityContractMember(body).status, 400);
});

test('validateLiabilityContractMember: rechaza sin items', () => {
  const body = { member: { name: 'M', email: 'm@b.com' }, contract_list: ['c1'], items: [] };
  assert.equal(validateLiabilityContractMember(body).status, 400);
});

test('validateLiabilityContractMember: aprueba con todos los campos', () => {
  const body = { member: { name: 'M', email: 'm@b.com' }, contract_list: ['c1'], items: ['i1'] };
  assert.equal(validateLiabilityContractMember(body), null);
});

test('buildLiabilityContractMemberMessage: usa member.email como destinatario', () => {
  const msg = buildLiabilityContractMemberMessage({ member: { name: 'M', email: 'm@b.com' }, contract_list: ['c1'], items: ['i1'] });
  assert.equal(msg.to, 'M <m@b.com>');
});

// ─── liabilityContractConsumerNotification ───────────────────────────────────

test('validateLiabilityContractConsumer: rechaza sin consumer.email/name', () => {
  assert.equal(validateLiabilityContractConsumer({}).status, 400);
});

test('validateLiabilityContractConsumer: aprueba con todos los campos', () => {
  const body = { consumer: { name: 'C', email: 'c@b.com' }, contract_list: ['c1'], items: ['i1'] };
  assert.equal(validateLiabilityContractConsumer(body), null);
});

test('buildLiabilityContractConsumerMessage: usa consumer.email como destinatario', () => {
  const msg = buildLiabilityContractConsumerMessage({ consumer: { name: 'C', email: 'c@b.com' }, contract_list: ['c1'], items: ['i1'] });
  assert.equal(msg.to, 'C <c@b.com>');
});

// ─── liabilityContractStaffNotification ──────────────────────────────────────

test('validateLiabilityContractStaff: rechaza sin staff.email/name', () => {
  assert.equal(validateLiabilityContractStaff({}).status, 400);
});

test('validateLiabilityContractStaff: aprueba con todos los campos', () => {
  const body = { staff: { name: 'S', email: 's@b.com' }, contract_list: ['c1'], items: ['i1'] };
  assert.equal(validateLiabilityContractStaff(body), null);
});

test('buildLiabilityContractStaffMessage: usa staff.email como destinatario', () => {
  const msg = buildLiabilityContractStaffMessage({ staff: { name: 'S', email: 's@b.com' }, contract_list: ['c1'], items: ['i1'] });
  assert.equal(msg.to, 'S <s@b.com>');
});

// ─── termsAndConditionsAcceptanceNotification ────────────────────────────────

test('validateTermsAndConditionsAcceptance: rechaza sin consumer.email', () => {
  assert.equal(validateTermsAndConditionsAcceptance({}).status, 400);
});

test('validateTermsAndConditionsAcceptance: rechaza sin nombre/apellido', () => {
  const body = { consumer: { email: 'a@b.com' } };
  assert.equal(validateTermsAndConditionsAcceptance(body).status, 400);
});

test('validateTermsAndConditionsAcceptance: rechaza email con formato inválido', () => {
  const body = { consumer: { email: 'not-an-email', name: 'A', lastName: 'B' } };
  assert.equal(validateTermsAndConditionsAcceptance(body).status, 400);
});

test('validateTermsAndConditionsAcceptance: aprueba con todos los campos válidos', () => {
  const body = { consumer: { email: 'a@b.com', name: 'A', lastName: 'B' } };
  assert.equal(validateTermsAndConditionsAcceptance(body), null);
});

test('buildTermsAndConditionsAcceptanceMessage: usa consumer.email como destinatario', () => {
  const msg = buildTermsAndConditionsAcceptanceMessage({ consumer: { email: 'a@b.com', name: 'A', lastName: 'B' } });
  assert.equal(msg.to, 'A B <a@b.com>');
});

// ─── documentSigningCompletionNotification (mensaje múltiple, payload array) ─

test('validateDocumentSigningCompletion: rechaza sin emails de assigner/staff', () => {
  assert.equal(validateDocumentSigningCompletion({}).status, 400);
});

test('validateDocumentSigningCompletion: rechaza sin contract_list', () => {
  const body = { assigner: { email: 'a@b.com' }, staff: { email: 's@b.com' }, contract_list: [] };
  assert.equal(validateDocumentSigningCompletion(body).status, 400);
});

test('validateDocumentSigningCompletion: rechaza email con formato inválido', () => {
  const body = { assigner: { email: 'bad' }, staff: { email: 's@b.com' }, contract_list: ['c1'] };
  assert.equal(validateDocumentSigningCompletion(body).status, 400);
});

test('validateDocumentSigningCompletion: aprueba con todos los campos válidos', () => {
  const body = { assigner: { email: 'a@b.com' }, staff: { email: 's@b.com' }, contract_list: ['c1'] };
  assert.equal(validateDocumentSigningCompletion(body), null);
});

test('buildDocumentSigningCompletionMessages: arma un array con un mensaje para assigner y otro para staff', () => {
  const msgs = buildDocumentSigningCompletionMessages({
    assigner: { name: 'Ass', email: 'a@b.com' },
    staff: { name: 'Sta', email: 's@b.com' },
    contract_list: ['c1'],
    verification_id: 'V1',
  });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].to, 'Ass <a@b.com>');
  assert.equal(msgs[1].to, 'Sta <s@b.com>');
});

// ─── consumerDocumentSigningCompletionNotification (mensaje múltiple) ────────

test('validateConsumerDocumentSigningCompletion: rechaza sin emails de assigner/consumer', () => {
  assert.equal(validateConsumerDocumentSigningCompletion({}).status, 400);
});

test('validateConsumerDocumentSigningCompletion: aprueba con todos los campos válidos', () => {
  const body = { assigner: { email: 'a@b.com' }, consumer: { email: 'c@b.com' }, contract_list: ['c1'] };
  assert.equal(validateConsumerDocumentSigningCompletion(body), null);
});

test('buildConsumerDocumentSigningCompletionMessages: arma un array con un mensaje para assigner y otro para consumer', () => {
  const msgs = buildConsumerDocumentSigningCompletionMessages({
    assigner: { name: 'Ass', email: 'a@b.com' },
    consumer: { name: 'Con', email: 'c@b.com' },
    contract_list: ['c1'],
    verification_id: 'V1',
  });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].to, 'Ass <a@b.com>');
  assert.equal(msgs[1].to, 'Con <c@b.com>');
});

// ─── consumerLeaseEndedDeviceReturnedNotification ────────────────────────────

test('validateConsumerLeaseEndedDeviceReturned: rechaza sin consumer/devices/returnDate', () => {
  assert.equal(validateConsumerLeaseEndedDeviceReturned({}).status, 400);
});

test('validateConsumerLeaseEndedDeviceReturned: rechaza email con formato inválido', () => {
  const body = { consumer: { email: 'bad' }, devices: ['d1'], returnDate: '2026-01-01' };
  assert.equal(validateConsumerLeaseEndedDeviceReturned(body).status, 400);
});

test('validateConsumerLeaseEndedDeviceReturned: aprueba con todos los campos válidos', () => {
  const body = { consumer: { email: 'a@b.com' }, devices: ['d1'], returnDate: '2026-01-01' };
  assert.equal(validateConsumerLeaseEndedDeviceReturned(body), null);
});

test('buildConsumerLeaseEndedDeviceReturnedMessage: usa consumer.email como destinatario', () => {
  const msg = buildConsumerLeaseEndedDeviceReturnedMessage({ consumer: { email: 'a@b.com', name: 'A' }, devices: ['d1'], returnDate: '2026-01-01' });
  assert.equal(msg.to, 'A <a@b.com>');
});
