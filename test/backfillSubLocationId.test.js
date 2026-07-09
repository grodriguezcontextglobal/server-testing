'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSubLocationSegments } = require('../mysql/scripts/backfill-sub-location-id');

test('parseSubLocationSegments: array real se devuelve tal cual', () => {
  assert.deepEqual(parseSubLocationSegments(['Building A', 'Floor 3']), ['Building A', 'Floor 3']);
});

test('parseSubLocationSegments: JSON string de array se parsea', () => {
  assert.deepEqual(parseSubLocationSegments('["Building A","Floor 3"]'), ['Building A', 'Floor 3']);
});

test('parseSubLocationSegments: string simple (no JSON) se envuelve en array de 1', () => {
  assert.deepEqual(parseSubLocationSegments('Dc Office'), ['Dc Office']);
});

test('parseSubLocationSegments: JSON string que no es array se envuelve en array de 1', () => {
  assert.deepEqual(parseSubLocationSegments('{"name":"Dc Office"}'), ['{"name":"Dc Office"}']);
});

test('parseSubLocationSegments: null/undefined -> array vacío', () => {
  assert.deepEqual(parseSubLocationSegments(null), []);
  assert.deepEqual(parseSubLocationSegments(undefined), []);
});

test('parseSubLocationSegments: [null,null,null] (data sucia) se preserva tal cual', () => {
  assert.deepEqual(parseSubLocationSegments([null, null, null]), [null, null, null]);
});

test('parseSubLocationSegments: tipos no soportados (number/boolean) -> array vacío', () => {
  assert.deepEqual(parseSubLocationSegments(42), []);
  assert.deepEqual(parseSubLocationSegments(true), []);
});
