'use strict';

// POST /api/auth/new respondía 500 "Please contact administrator" a todo
// consumidor nuevo cuyo teléfono no fuera un número puro, y también sin
// teléfono: phoneNumber era Number con default "000-000-0000", y Mongoose
// intenta castear ese default al construir el documento.

const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');

const base = {
  name: 'Sara',
  lastName: 'Mendoza',
  email: 'sara@example.com',
  privacyPolicy: true,
  category: 'Regular',
  provider: ['Test Company'],
  eventSelected: ['First Event'],
  company_providers: ['6a7d9ef28f33f83745aa54e2'],
  event_providers: ['6ad10b36d28040ba6cc0528d'],
  groupName: [],
};

test('User: teléfonos con formato, numéricos, vacíos o ausentes validan', () => {
  for (const phoneNumber of ['555-1017', '+1 (415) 555-0400', 5551017, '', undefined]) {
    const body = phoneNumber === undefined ? base : { ...base, phoneNumber };
    const error = new User(body).validateSync();
    assert.equal(error, undefined, `${JSON.stringify(phoneNumber)}: ${error?.message}`);
  }
});

test('User: se guarda tal cual llega, y sin teléfono queda el default', () => {
  assert.equal(new User({ ...base, phoneNumber: '555-1017' }).phoneNumber, '555-1017');
  assert.equal(new User({ ...base, phoneNumber: 5551017 }).phoneNumber, '5551017');
  assert.equal(new User(base).phoneNumber, '000-000-0000');
});
