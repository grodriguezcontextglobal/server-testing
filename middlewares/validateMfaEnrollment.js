'use strict';

const { validateJWT } = require('./validate-jwt');
const { verifyMfaSetupToken } = require('../helpers/mfaSetupToken');

/**
 * Para /mfa/generate y /mfa/verify: acepta el token de enrolamiento
 * (header `x-mfa-setup-token`, el que da el login a una cuenta sin MFA) o, si
 * no viene, un JWT de sesión normal (`x-token`), como hasta ahora.
 */
const validateMfaEnrollment = (request, response, next) => {
  const setupToken = request.header('x-mfa-setup-token');
  if (!setupToken) return validateJWT(request, response, next);

  try {
    request.uid = verifyMfaSetupToken(setupToken);
    request.mfaSetup = true;
  } catch {
    return response.status(401).json({
      ok: false,
      msg: 'MFA setup token is not valid or has expired. Log in again.',
    });
  }
  return next();
};

module.exports = { validateMfaEnrollment };
