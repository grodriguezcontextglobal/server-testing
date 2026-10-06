'use strict';

const { validateJWT } = require('./validate-jwt');
const { verifyMfaSetupToken } = require('../helpers/mfaSetupToken');

/**
 * Para /mfa/generate y /mfa/verify: acepta el token de enrolamiento (el que da
 * el login a una cuenta sin MFA) o un JWT de sesión normal, como hasta ahora.
 *
 * El token de enrolamiento puede venir en `x-mfa-setup-token` o en `x-token`.
 * Lo segundo es por el dashboard: su modal de enrolamiento ya manda en `x-token`
 * el token que le pasan (`mfaRequestConfig`), así que solo tiene que pasarle el
 * `mfaSetupToken` en vez del de sesión. Aceptarlo ahí no abre nada: está firmado
 * con otro secreto, así que validateJWT lo sigue rechazando en cualquier otra
 * ruta.
 */
const validateMfaEnrollment = (request, response, next) => {
  const explicit = request.header('x-mfa-setup-token');

  if (explicit) {
    try {
      request.uid = verifyMfaSetupToken(explicit);
      request.mfaSetup = true;
      return next();
    } catch {
      return response.status(401).json({
        ok: false,
        msg: 'MFA setup token is not valid or has expired. Log in again.',
      });
    }
  }

  const xToken = request.header('x-token');
  if (xToken) {
    try {
      request.uid = verifyMfaSetupToken(xToken);
      request.mfaSetup = true;
      return next();
    } catch {
      // No es de enrolamiento: se valida como sesión normal.
    }
  }
  return validateJWT(request, response, next);
};

module.exports = { validateMfaEnrollment };
