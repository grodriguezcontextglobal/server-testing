'use strict';

const jwt = require('jsonwebtoken');

/**
 * Token del enlace de invitación a una compañía.
 *
 * Antes el enlace lo armaba el navegador (first, last, email, company) y
 * POST /api/registration/accept-invitation no tenía autenticación: con saber un
 * email invitado y la compañía, cualquiera aceptaba en su nombre. Si la cuenta
 * no existía, además elegía la contraseña y se quedaba con ella.
 *
 * Ahora lo firma el servidor al enviar el correo (ver
 * controller/registration.js § attachInvitationLink) y solo viaja ahí: quien lo
 * presenta demuestra que controla ese buzón. Nombra la compañía por su _id y el
 * email invitado. Deja de servir cuando la invitación ya está `Confirmed` o la
 * quitaron de `Company.employees`; eso lo comprueba acceptInvitation.
 */

const PURPOSE = 'staff_invitation';
const TTL = '7d';

const secret = () => `${process.env.SECRET_JWT_SEED}:${PURPOSE}`;

function generateInvitationToken({ email, companyId }) {
  return new Promise((resolve, reject) => {
    jwt.sign(
      { email: String(email), companyId: String(companyId), purpose: PURPOSE },
      secret(),
      { expiresIn: TTL },
      (err, token) => (err ? reject(err) : resolve(token)),
    );
  });
}

/** { email, companyId } si el token es válido y no caducó; null si no. */
function readInvitationToken(token) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, secret());
    if (payload.purpose !== PURPOSE || !payload.email || !payload.companyId) return null;
    return { email: payload.email, companyId: payload.companyId };
  } catch {
    return null;
  }
}

module.exports = { generateInvitationToken, readInvitationToken };
