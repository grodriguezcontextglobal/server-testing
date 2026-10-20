'use strict';

/**
 * Stripe Fase 1.2 (PLAN_stripe_2026-10-06.md), 2026-10-19.
 *
 * La Idempotency-Key la elige el cliente, y se usaba CRUDA en dos sitios:
 *   - la caché de respuestas (middlewares/idempotencyMutationCache.js): dos
 *     compañías con la misma clave recibían la respuesta guardada de la otra;
 *   - la clave que se le pasa a Stripe (middlewares/attachServerIdempotencyKey.js):
 *     las claves de Stripe son por CUENTA y hay una sola para todas las
 *     compañías, así que la misma clave en 24 h devolvía el MISMO PaymentIntent
 *     (con su client_secret) a quien la repitiera.
 *
 * Ahora la clave efectiva es sha256(compañía | usuario | método ruta | clave). Un
 * reintento legítimo (misma compañía, usuario, ruta y clave) da la misma clave,
 * así que la deduplicación sigue funcionando; la misma clave en otro contexto ya
 * no choca.
 */

const crypto = require('crypto');
const { resolveCompanyContext } = require('./companyContext');

function scopeIdempotencyKey(req, clientKey) {
  const company = resolveCompanyContext(req) ?? '';
  const actor = req.uid ?? '';
  const route = `${req.method} ${req.baseUrl || ''}${req.path || ''}`;
  return crypto
    .createHash('sha256')
    .update([company, actor, route, String(clientKey).trim()].join('|'))
    .digest('hex');
}

module.exports = { scopeIdempotencyKey };
