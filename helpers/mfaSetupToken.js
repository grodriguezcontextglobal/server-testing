'use strict';

const jwt = require('jsonwebtoken');

/**
 * Token de enrolamiento de MFA.
 *
 * MFA es obligatoria: una cuenta sin `mfaEnabled` no recibe JWT de sesión. Pero
 * para enrolarse necesita llamar a /mfa/generate y /mfa/verify, así que el login
 * (y el alta) le dan este token en su lugar. Solo sirve para esas dos rutas.
 *
 * Se firma con un secreto DERIVADO del de sesión, no con el mismo: así
 * validateJWT lo rechaza sin tener que tocarlo, y un token de sesión tampoco
 * pasa por aquí. Dura poco porque solo cubre el tiempo de escanear el QR.
 */

const PURPOSE = 'mfa_setup';
const TTL = '15m';

const secret = () => `${process.env.SECRET_JWT_SEED}:${PURPOSE}`;

function generateMfaSetupToken(uid) {
  return new Promise((resolve, reject) => {
    jwt.sign({ uid: String(uid), purpose: PURPOSE }, secret(), { expiresIn: TTL }, (err, token) =>
      err ? reject(err) : resolve(token),
    );
  });
}

/** Devuelve el uid, o lanza si el token no es válido, caducó o no es de enrolamiento. */
function verifyMfaSetupToken(token) {
  const payload = jwt.verify(token, secret());
  if (payload.purpose !== PURPOSE || !payload.uid) {
    throw new Error('Not an MFA setup token');
  }
  return payload.uid;
}

/**
 * MFA es obligatoria salvo que MFA_REQUIRED=false. El interruptor existe para
 * entornos locales/demo y como vuelta atrás de emergencia sin desplegar: con
 * la obligación activa, toda cuenta sin MFA tiene que enrolarse en su próximo
 * login.
 */
const isMfaRequired = () => process.env.MFA_REQUIRED !== 'false';

module.exports = { generateMfaSetupToken, verifyMfaSetupToken, isMfaRequired };
