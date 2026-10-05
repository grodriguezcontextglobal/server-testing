'use strict';

/**
 * helpers/auditDescribe.js: cada registro del audit trail tiene que leerse como
 * una frase — qué se hizo, sobre qué y sobre quién. Los casos salen de
 * registros reales de producción del 2026-10-05.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeEntry } = require('../helpers/auditDescribe');

const route = (r) => ({ route: r });

test('receiver-update con status false es una DEVOLUCIÓN, con serial, consumidor y evento', () => {
  const out = describeEntry({
    action: 'UPDATE',
    target_model: 'Device',
    target_id: 'R1',
    details: { ...route('PATCH /api/receiver/receiver-update/:id'), request: { device: { status: false } } },
    context: { serial_numbers: ['SN-100006'], consumer: 'ana@x.com', event_name: 'TEST _ 2' },
  });
  assert.equal(out.action, 'RETURN');
  assert.equal(out.summary, 'Returned device SN-100006 from ana@x.com at event TEST _ 2');
  assert.equal(out.target_label, 'SN-100006');
});

test('receiver-update con status true es una ASIGNACIÓN', () => {
  const out = describeEntry({
    action: 'UPDATE',
    target_model: 'Device',
    details: { ...route('PATCH /api/receiver/receiver-update/:id'), request: { device: { status: true } } },
    context: { serial_numbers: ['SN-1'], consumer: 'ana@x.com' },
  });
  assert.equal(out.action, 'ASSIGN');
  assert.equal(out.summary, 'Assigned device SN-1 to ana@x.com');
});

test('el pool del evento dice si el equipo quedó libre o en uso', () => {
  const base = {
    action: 'UPDATE',
    target_model: 'Device',
    details: route('PATCH /api/receiver/receivers-pool-update/:id'),
    context: { serial_numbers: ['SN-100006'], event_name: 'TEST _ 2' },
  };
  assert.equal(
    describeEntry({ ...base, details: { ...base.details, request: { activity: false } } }).summary,
    'Marked device SN-100006 as available in the pool at event TEST _ 2',
  );
  assert.equal(
    describeEntry({ ...base, details: { ...base.details, request: { activity: true } } }).summary,
    'Marked device SN-100006 as in use in the pool at event TEST _ 2',
  );
});

test('un correo dice qué correo y a quién', () => {
  const out = describeEntry({
    action: 'SEND',
    target_model: 'Email',
    details: route('POST /api/nodemailer/assignig-device-notification'),
    context: { recipients: ['ana@x.com'] },
  });
  assert.equal(out.summary, 'Sent "device assignment" email to ana@x.com');
});

test('abrir el panel de Stripe se lee como tal (el caso reportado)', () => {
  const out = describeEntry({
    action: 'OPEN',
    target_model: 'StripeAccount',
    target_id: 'acct_1U3wd6JNGnMoHT28',
    details: route('POST /api/stripe/account_sessions'),
  });
  assert.equal(out.summary, 'Opened the Stripe payments dashboard (account acct_1U3wd6JNGnMoHT28)');
});

test('inventario: salida del almacén, asignación al evento e import', () => {
  assert.equal(
    describeEntry({
      action: 'CHECK_OUT',
      target_model: 'Inventory',
      context: { serial_numbers: ['A1', 'A2', 'A3', 'A4'], event_id: '701' },
    }).summary,
    'Checked out 4 items (A1, A2, A3, +1 more) from the warehouse for event #701',
  );
  assert.equal(
    describeEntry({ action: 'ASSIGN', target_model: 'Inventory', context: { item_ids: ['9'], event_name: 'Feria' }, target_id: '9' }).summary,
    'Assigned inventory #9 to event Feria',
  );
  assert.equal(
    describeEntry({ action: 'IMPORT', target_model: 'Inventory', context: { count: 120 } }).summary,
    'Imported 120 inventory items',
  );
});

test('login y force-logout (registros de los controladores, sin ruta)', () => {
  assert.equal(describeEntry({ action: 'LOGIN', target_model: 'AdminUser', target_id: 'U1' }).summary, 'Logged in');
  assert.equal(describeEntry({ action: 'LOGIN', target_model: 'AdminUser', target_id: 'U1' }).target_label, undefined);
  assert.equal(
    describeEntry({ action: 'FORCE_LOGOUT', target_model: 'AdminUser', target_label: 'bob@x.com' }).summary,
    'Ended the active session of bob@x.com',
  );
});

test('una acción sin clasificar se describe igual y lo dice', () => {
  const out = describeEntry({
    action: 'CREATE',
    target_model: 'Widget',
    details: { route: 'POST /api/widget/new', inferred: true },
  });
  assert.equal(out.summary, 'Created widget (unclassified action)');
});

test('la limpieza de caché se marca como automática', () => {
  const out = describeEntry({ action: 'CLEAR', target_model: 'Cache', details: route('POST /api/cache_update/remove-cache') });
  assert.match(out.summary, /automatic/);
});
