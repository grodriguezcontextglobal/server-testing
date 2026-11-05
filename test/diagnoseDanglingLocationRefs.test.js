'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestRepoint } = require('../mysql/scripts/diagnose-dangling-location-refs');

const live = [
  { location_id: 31, location_name: 'Washington, DC' },
  { location_id: 33, location_name: 'Fort Lauderdale, Fl' },
  { location_id: 40, location_name: 'Gym' },
  { location_id: 41, location_name: 'gym ' },
];

test('un nombre deducido que existe una sola vez en la compañía → candidata', () => {
  assert.deepEqual(suggestRepoint(['washington,  dc', 'Washington, DC'], live), {
    name: 'washington, dc', candidate: 31, why: 'mismo nombre en la compañía',
  });
});

test('sin nombre, varios nombres, varias coincidencias o ninguna → sin candidata, con el motivo', () => {
  assert.equal(suggestRepoint([], live).why, 'sin nombre que deducir');
  assert.equal(suggestRepoint(['A', 'B'], live).candidate, null);
  assert.equal(suggestRepoint(['Gym'], live).why, 'varias locaciones con ese nombre');
  assert.match(suggestRepoint(['Library'], live).why, /no existe/);
});
