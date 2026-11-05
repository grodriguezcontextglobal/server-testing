'use strict';

/**
 * helpers/auditDisplay.js: el desglose quién / qué / cómo / a quién / dónde /
 * cuándo que pinta el cliente. Los casos son registros reales de producción
 * del 2026-10-05.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeEntry } = require('../helpers/auditDescribe');
const { buildDisplay, fieldsOf, routeParts } = require('../helpers/auditDisplay');

// Igual que el worker: describir y luego desglosar con el verbo y el objeto.
function display(entry, opts = {}) {
  const d = describeEntry(entry);
  const final = { ...entry, ...(d.action ? { action: d.action } : {}), summary: d.summary, target_label: entry.target_label || d.target_label };
  return buildDisplay(final, { ...opts, verb: d.verb, object: d.object });
}

const ACTOR = { name: 'Gustavo Santeliz', email: 'g@x.com' };
const WHEN = new Date('2026-10-05T18:07:55.880Z');

test('devolución desde el consumidor del evento: cada pregunta en su sección', () => {
  const d = display({
    actor: ACTOR,
    actor_type: 'staff',
    staff_member_id: 'U1',
    action: 'UPDATE',
    target_model: 'Device',
    target_id: 'R1',
    timestamp: WHEN,
    details: {
      route: 'PATCH /api/receiver/receiver-update/:id',
      request: { id: 'R1', device: { serialNumber: 'SN-100007', deviceType: 'Laptop', status: false } },
    },
    context: { serial_numbers: ['SN-100007'], consumer: 'lucia@x.com', event_name: 'TEST _ 2' },
  }, { companyName: 'Test Company' });

  assert.deepEqual(d.who, { name: 'Gustavo Santeliz', email: 'g@x.com', kind: 'staff' });
  assert.deepEqual(d.what, { action: 'RETURN', verb: 'Returned', object: 'device SN-100007', model: 'Device' });
  assert.equal(d.how.method, 'PATCH');
  assert.equal(d.how.operation, 'Receiver update');
  assert.deepEqual(d.how.fields, [
    { label: 'Device › Serial number', value: 'SN-100007' },
    { label: 'Device › Device type', value: 'Laptop' },
    { label: 'Device › Status', value: 'Returned' }, // no "No"
  ]);
  assert.deepEqual(d.whom, { kind: 'consumer', label: 'lucia@x.com' });
  assert.deepEqual(d.where, { event: 'TEST _ 2', company: 'Test Company' });
  assert.equal(d.when, '2026-10-05T18:07:55.880Z');
});

test('what.object no repite a quién ni dónde (van en whom / where)', () => {
  const d = display({
    action: 'ASSIGN', target_model: 'Device',
    context: { serial_numbers: ['SN-1'], consumer: 'a@x.com', event_name: 'Feria' },
  });
  assert.equal(d.what.object, 'device SN-1');
});

test('el pool usa el mismo verbo que la frase ("Marked"), no "Updated"', () => {
  const d = display({
    action: 'UPDATE', target_model: 'Device',
    details: { route: 'PATCH /api/receiver/receivers-pool-update/:id', request: { activity: false } },
    context: { serial_numbers: ['SN-1'], event_name: 'Feria' },
  });
  assert.equal(d.what.verb, 'Marked');
  assert.equal(d.what.object, 'device SN-1 as available in the pool');
});

test('un correo: a quién va en whom, y los campos del payload en how', () => {
  const d = display({
    action: 'SEND', target_model: 'Email',
    details: {
      route: 'POST /api/nodemailer/confirm-returned-device-notification',
      request: { consumer: { email: 'l@x.com', firstName: 'Lucia' }, event: 'TEST _ 2', transaction: 'pi_1' },
    },
    context: { recipients: ['l@x.com'] },
  });
  assert.equal(d.what.object, '"device return confirmation" email');
  assert.deepEqual(d.whom, { kind: 'recipients', label: 'l@x.com' });
  assert.ok(d.how.fields.some((f) => f.label === 'Consumer › First name' && f.value === 'Lucia'));
});

test('editar a otro staff: whom lo identifica aunque solo venga su id en el body', () => {
  const d = display({
    staff_member_id: 'U1', action: 'UPDATE', target_model: 'Staff',
    details: { route: 'PATCH /api/db_staff/company-staff', request: { staff_id: 207, role_type: 'admin' } },
  });
  assert.deepEqual(d.whom, { kind: 'staff', label: '#207' });
  assert.deepEqual(d.how.fields, [{ label: 'Role type', value: 'admin' }]); // staff_id es id técnico
});

test('editar la propia cuenta: sin whom (es uno mismo)', () => {
  const d = display({ staff_member_id: 'U1', target_id: 'U1', action: 'UPDATE', target_model: 'AdminUser' });
  assert.equal(d.whom, null);
  assert.equal(d.what.object, 'their own profile');
});

test('lectura de datos de alumnos (ruta sin método)', () => {
  const d = display({
    action: 'READ', target_model: 'SchoolPII', details: { route: '/api/school/consent/list', status: 200 },
  });
  assert.equal(d.what.verb, 'Viewed');
  assert.equal(d.what.object, 'student records (consent list)');
  assert.equal(d.how.method, undefined);
  assert.equal(d.how.endpoint, '/api/school/consent/list');
});

test('fieldsOf: omite ids técnicos y credenciales, formatea booleanos y listas', () => {
  const f = fieldsOf({
    id: 'x', company_id: 9, password: '[redacted]', active: true,
    serials: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], items: [{ a: 1 }, { a: 2 }],
  });
  assert.deepEqual(f, [
    { label: 'Active', value: 'Yes' },
    { label: 'Serials', value: 'A, B, C, D, E (+2 more)' },
    { label: 'Items', value: '2 entries' },
  ]);
});

test('routeParts: método, endpoint y nombre legible de la operación', () => {
  assert.deepEqual(routeParts('POST /api/db_item/bulk-item-from-spreadsheet'), {
    method: 'POST', endpoint: '/api/db_item/bulk-item-from-spreadsheet', operation: 'Bulk item from spreadsheet',
  });
});
