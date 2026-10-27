'use strict';

const crypto = require('crypto');

/**
 * Códigos de recuperación de MFA (FedRAMP A5 · IA-2, IA-5).
 *
 * Son el camino para quien pierde el teléfono con la app de autenticación: en
 * el login sirven en lugar del código TOTP, una sola vez cada uno.
 *
 *   - 10 códigos de 16 caracteres base32 (80 bits cada uno), mostrados como
 *     xxxx-xxxx-xxxx-xxxx. Solo se ven una vez: al activar MFA o al regenerar.
 *   - En la base se guarda SHA-256(uid:código). Con 80 bits de entropía un hash
 *     rápido ya resiste un ataque offline, y el uid como sal impide comparar
 *     hashes entre cuentas.
 *   - Se aceptan con o sin guiones, en mayúsculas o minúsculas.
 */

const COUNT = 10;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function randomCode() {
  const bytes = crypto.randomBytes(16);
  let raw = '';
  for (const b of bytes) raw += ALPHABET[b & 31];
  return raw.match(/.{4}/g).join('-');
}

const normalize = (code) => String(code ?? '').replace(/[\s-]/g, '').toLowerCase();

function hashRecoveryCode(uid, code) {
  return crypto.createHash('sha256').update(`${uid}:${normalize(code)}`).digest('hex');
}

/** Devuelve { codes } en claro para mostrarlos y { hashes } para guardarlos. */
function generateRecoveryCodes(uid) {
  const codes = Array.from({ length: COUNT }, randomCode);
  return { codes, hashes: codes.map((c) => hashRecoveryCode(uid, c)) };
}

/** Descarta a la primera lo que no puede ser un código, sin tocar la base. */
const looksLikeRecoveryCode = (code) => /^[a-z2-7]{16}$/.test(normalize(code));

module.exports = { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode, RECOVERY_CODE_COUNT: COUNT };
