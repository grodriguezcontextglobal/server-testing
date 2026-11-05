'use strict';

const { ipKeyGenerator } = require('express-rate-limit');

/**
 * Clave por IP para los keyGenerator propios de express-rate-limit (AC-7; 2026-11-05).
 *
 * Desde la v8, express-rate-limit agrupa las IPv6 por subred (/56) con
 * ipKeyGenerator: un cliente IPv6 controla toda su subred y, con la IP
 * completa como clave, saltaba el límite cambiando de dirección. Las IPv4
 * pasan sin cambios. La v8 avisa (ERR_ERL_KEY_GEN_IPV6) de todo keyGenerator
 * que lea request.ip sin pasar por aquí.
 *
 * request.ip ya llega sin puerto: normalizeForwardedFor va el primero en index.js.
 */
function clientIpKey(request) {
  return request.ip ? ipKeyGenerator(request.ip) : 'unknown';
}

module.exports = { clientIpKey };
