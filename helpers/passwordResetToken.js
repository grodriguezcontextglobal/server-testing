'use strict';

const jwt = require('jsonwebtoken');

/**
 * Token del enlace de "olvidé mi contraseña".
 *
 * Antes el enlace lo armaba el navegador (uid + email + stamp-time), así que
 * conocer un email bastaba para fabricarlo. Ahora lo firma el servidor y solo
 * viaja en el correo: quien lo presenta demuestra que controla ese buzón. Es
 * lo que permite darle un `mfaSetupToken` a una cuenta sin MFA desde el reset
 * (ver controller/admin.js § updatePassword).
 *
 * De un solo uso sin guardar estado: el secreto se deriva del hash ACTUAL de
 * la contraseña, así que en cuanto la contraseña cambia el token deja de
 * validar. Quien lo verifique tiene que cargar el usuario con `+password`.
 */

const PURPOSE = 'password_reset';
const TTL = '1h';

const secret = (passwordHash) => `${process.env.SECRET_JWT_SEED}:${PURPOSE}:${passwordHash}`;

function generatePasswordResetToken(adminUser) {
  return new Promise((resolve, reject) => {
    jwt.sign(
      { uid: String(adminUser.id ?? adminUser._id), purpose: PURPOSE },
      secret(adminUser.password),
      { expiresIn: TTL },
      (err, token) => (err ? reject(err) : resolve(token)),
    );
  });
}

/** uid que dice el token, SIN verificar: solo para saber qué usuario cargar. */
function readPasswordResetUid(token) {
  const payload = typeof token === 'string' ? jwt.decode(token) : null;
  return payload && payload.purpose === PURPOSE && typeof payload.uid === 'string' ? payload.uid : null;
}

/** true si el token es de ese usuario, no caducó y su contraseña no ha cambiado. */
function isValidPasswordResetToken(token, adminUser) {
  if (!adminUser?.password) return false;
  try {
    const payload = jwt.verify(token, secret(adminUser.password));
    return payload.purpose === PURPOSE && payload.uid === String(adminUser.id ?? adminUser._id);
  } catch {
    return false;
  }
}

module.exports = { generatePasswordResetToken, readPasswordResetUid, isValidPasswordResetToken };
