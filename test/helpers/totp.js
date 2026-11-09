'use strict';

/**
 * Código TOTP para los tests de login con MFA, sin la carrera del borde de la
 * ventana.
 *
 * El código cambia cada 30 s (:00 y :30) y el servidor lo verifica con
 * window 0. Un test que generaba el código a las :59.9 y llegaba al
 * verify a las :00.0 recibía "Invalid MFA code": falló así en CI el
 * 2026-11-09 a las 21:21:00.07 (staffSession.test.js, push de #53).
 *
 * Si quedan menos de MARGIN_MS en la ventana, espera a la siguiente antes de
 * generar. Es síncrono a propósito (espera activa, como mucho ~1,5 s y solo
 * en ~5 % de las llamadas) para no tener que convertir en `await` los ~40
 * sitios que hacen `mfaCode: totp()`.
 */

const speakeasy = require('speakeasy');

const STEP_MS = 30_000;
const MARGIN_MS = 1_500;

function totpNow(secret, { now = Date.now } = {}) {
  const remaining = STEP_MS - (now() % STEP_MS);
  if (remaining < MARGIN_MS) {
    const until = now() + remaining + 50;
    while (now() < until) {
      /* esperar a la ventana siguiente */
    }
  }
  return speakeasy.totp({ secret, encoding: 'base32' });
}

module.exports = { totpNow, STEP_MS, MARGIN_MS };
