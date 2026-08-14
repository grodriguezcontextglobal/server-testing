'use strict';

// B3.1 incident notification (lost / damaged) and B3.2 fee receipt.
//
// The bug these replace: all three outcomes posted to the successful-return
// endpoint, so the guardian of a lost laptop received written confirmation of a
// return that never happened. The hard rules are asserted here, not just the
// happy path.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  memberDeviceIncidentMessageHtml,
  memberDeviceFeeReceiptMessageHtml,
} = require('../nodeMailer/returningDeviceMessage');
const {
  buildMemberDeviceIncidentMessage,
  buildMemberDeviceFeeReceiptMessage,
  validateMemberDeviceIncident,
  validateMemberDeviceFeeReceipt,
} = require('../nodeMailer/notifications');

const incidentBody = (overrides = {}) => ({
  member: { firstName: 'Blaise', lastName: 'Pascal', email: 'parent@home.com' },
  devices: [{ device: { serialNumber: 'SN-1', deviceType: 'Laptop' } }],
  outcome: 'lost',
  outcomeLabel: 'Declared lost — device not recovered',
  conditionNote: 'Reported lost by student on 6/2',
  feeAmount: 250.0,
  ...overrides,
});

// --------------------------------------------------------------------------
// B3.1 — the rules that made this endpoint necessary
// --------------------------------------------------------------------------

test('a lost device is never described as returned', () => {
  const html = memberDeviceIncidentMessageHtml(incidentBody());
  assert.doesNotMatch(html, /return/i);
  assert.match(html, /reported lost/i);
  assert.match(html, /has not been recovered/i);
});

test('damaged branches to its own wording', () => {
  const html = memberDeviceIncidentMessageHtml(
    incidentBody({
      outcome: 'damaged',
      outcomeLabel: 'Returned damaged — cracked screen',
      conditionNote: 'Screen cracked, powers on',
    })
  );
  assert.match(html, /Device returned damaged/);
  assert.doesNotMatch(html, /reported lost/i);
  // never "returned successfully" — it came back, but not intact
  assert.doesNotMatch(html, /successfully/i);
});

test('outcomeLabel is printed verbatim so paper and email cannot disagree', () => {
  const label = 'Declared lost — device not recovered';
  const html = memberDeviceIncidentMessageHtml(incidentBody({ outcomeLabel: label }));
  assert.ok(html.includes(label));
});

test('the recipient is greeted neutrally — the student name identifies the subject', () => {
  const html = memberDeviceIncidentMessageHtml(incidentBody());
  assert.match(html, /Hello,/);
  assert.doesNotMatch(html, /Dear Blaise/);
  // the child is still named, so the guardian knows which one this is about
  assert.ok(html.includes('Blaise Pascal'));
});

test('feeAmount null says nothing about money at all', () => {
  const html = memberDeviceIncidentMessageHtml(incidentBody({ feeAmount: null }));
  assert.ok(!html.includes('$'));
  assert.doesNotMatch(html, /0\.00/);
  assert.doesNotMatch(html, /replacement fee/i);
});

test('feeAmount prints dollars, not cents, and does not read as a receipt', () => {
  const html = memberDeviceIncidentMessageHtml(incidentBody({ feeAmount: 250 }));
  assert.ok(html.includes('$250.00'));
  assert.ok(!html.includes('25000'));
  assert.match(html, /not a receipt/i);
});

test('feeAmount is formatted with thousand separators', () => {
  const html = memberDeviceIncidentMessageHtml(incidentBody({ feeAmount: 1250.5 }));
  assert.ok(html.includes('$1,250.50'));
});

test('a null conditionNote omits the section instead of printing "null"', () => {
  const html = memberDeviceIncidentMessageHtml(incidentBody({ conditionNote: null }));
  assert.ok(!html.includes('null'));
  assert.doesNotMatch(html, /Note from school staff/);
});

test('staff free text cannot break out of the markup', () => {
  const html = memberDeviceIncidentMessageHtml(
    incidentBody({ conditionNote: '<script>alert("x")</script> & "quoted"' })
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('the device is listed by serial and type', () => {
  const html = memberDeviceIncidentMessageHtml(incidentBody());
  assert.ok(html.includes('SN-1'));
  assert.ok(html.includes('Laptop'));
});

test('incident: the resolved address is used as given, with no student name attached', () => {
  const msg = buildMemberDeviceIncidentMessage(incidentBody());
  assert.equal(msg.to, 'parent@home.com');
  assert.equal(msg.subject, 'Device reported lost — Blaise Pascal');
});

test('incident: damaged gets its own subject line', () => {
  const msg = buildMemberDeviceIncidentMessage(incidentBody({ outcome: 'damaged' }));
  assert.equal(msg.subject, 'Device returned damaged — Blaise Pascal');
});

test('incident: rejects a missing recipient and a non-incident outcome', () => {
  assert.equal(validateMemberDeviceIncident(incidentBody()), null);
  assert.equal(validateMemberDeviceIncident({ ...incidentBody(), member: {} }).status, 400);
  // a clean return must never reach this template
  assert.equal(
    validateMemberDeviceIncident(incidentBody({ outcome: 'returned' })).status,
    400
  );
});

// --------------------------------------------------------------------------
// B3.2 — a receipt, not an invoice
// --------------------------------------------------------------------------

const receiptBody = (overrides = {}) => ({
  member: { firstName: 'Blaise', lastName: 'Pascal', email: 'parent@home.com' },
  billedGuardian: true,
  lines: [{ serialNumber: 'SN-1', reason: 'Lost — not recovered', amount: 250.0 }],
  total: 250.0,
  paymentIntent: 'pi_3AbCdEfGhIjKlMnO',
  company: 'Bridges Academy',
  date: '2026-08-12T20:15:00Z',
  ...overrides,
});

test('the receipt does not ask for money that has already been captured', () => {
  const html = memberDeviceFeeReceiptMessageHtml(receiptBody());
  assert.match(html, /Payment receipt/);
  assert.match(html, /No further action is needed/);
  assert.doesNotMatch(html, /amount due/i);
  assert.doesNotMatch(html, /please pay/i);
  assert.doesNotMatch(html, /invoice/i);
});

test('the payment intent appears as the reference for a dispute', () => {
  const html = memberDeviceFeeReceiptMessageHtml(receiptBody());
  assert.ok(html.includes('pi_3AbCdEfGhIjKlMnO'));
});

test('a guardian who paid is told which student it was for', () => {
  const html = memberDeviceFeeReceiptMessageHtml(receiptBody({ billedGuardian: true }));
  assert.match(html, /on behalf of/);
  assert.ok(html.includes('Blaise Pascal'));
});

test('an adult student paying for themselves is not told they paid on their own behalf', () => {
  const html = memberDeviceFeeReceiptMessageHtml(receiptBody({ billedGuardian: false }));
  assert.doesNotMatch(html, /on behalf of/);
});

test('receipt amounts are dollars and the total is shown', () => {
  const html = memberDeviceFeeReceiptMessageHtml(receiptBody());
  assert.ok(html.includes('$250.00'));
  assert.match(html, /Total paid/);
  assert.ok(!html.includes('25000'));
});

test('receipt: addressed to the account actually charged', () => {
  const msg = buildMemberDeviceFeeReceiptMessage(receiptBody());
  assert.equal(msg.to, 'parent@home.com');
  assert.equal(msg.subject, 'Payment receipt — Bridges Academy');
});

test('receipt: rejects a missing recipient', () => {
  assert.equal(validateMemberDeviceFeeReceipt(receiptBody()), null);
  assert.equal(validateMemberDeviceFeeReceipt({ ...receiptBody(), member: {} }).status, 400);
});
