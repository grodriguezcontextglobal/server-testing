'use strict';

/**
 * test/helpers/totp.js: el código de MFA de los tests no puede caer en el borde
 * de la ventana de 30 s (fallo intermitente de CI del 2026-11-09).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const speakeasy = require('speakeasy');
const { totpNow, STEP_MS, MARGIN_MS } = require('./helpers/totp');

const secret = speakeasy.generateSecret().base32;

test('la causa: un código de las :29.9 ya no vale a las :30.0 con window 0 (lo que hace el login)', () => {
  const token = speakeasy.totp({ secret, encoding: 'base32', time: 29.9 });
  assert.equal(speakeasy.totp.verify({ secret, encoding: 'base32', token, time: 29.95 }), true);
  assert.equal(speakeasy.totp.verify({ secret, encoding: 'base32', token, time: 30.05 }), false);
});

test('a menos de MARGIN_MS del borde espera a la ventana siguiente', () => {
  let t = 10 * STEP_MS + STEP_MS - (MARGIN_MS - 500); // quedan 1 s
  const now = () => (t += 7);
  const code = totpNow(secret, { now });
  assert.match(code, /^\d{6}$/);
  assert.ok(t % STEP_MS < STEP_MS - MARGIN_MS, 'ya está dentro de la ventana siguiente');
});

test('lejos del borde no espera', () => {
  let calls = 0;
  const now = () => (calls++, 5 * STEP_MS + 1000);
  totpNow(secret, { now });
  assert.equal(calls, 1);
});
