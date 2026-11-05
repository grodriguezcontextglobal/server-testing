'use strict';

/**
 * Operadores de Mongo en la entrada del cliente (FedRAMP SI-10, 2026-11-02).
 *
 * express.json() y el parser de query extendido (qs) convierten
 * `{"email": {"$ne": null}}` o `?email[$regex]=^a` en objetos. Muchos
 * controladores pasan esos campos tal cual a findOne(): con un operador en vez
 * de un string, la consulta deja de buscar "este email" y pasa a buscar
 * "cualquiera" o "los que empiecen por". Semgrep marcó 27 findOne (CI del
 * 2026-11-02): 7 alcanzables, 3 de ellos sin sesión
 * (company-account-stripe, force-logout, alta de compañía).
 *
 * Ningún cliente legítimo manda claves que empiezan por `$`: el dashboard y la
 * app de consumidor mandan valores, no filtros. Las dos rutas que aceptan un
 * filtro del cliente (stripe.js y transaction.js) ya lo pasan por
 * mongoose.sanitizeFilter; si en el log aparecieran llamadas suyas con
 * operadores, es el momento de verlo, antes de enforce.
 *
 * NOSQL_INPUT_MODE:
 *   warn     (por defecto) deja pasar y registra lo que enforce rechazaría.
 *            scripts/summarize-warn-logs.js lo cuenta.
 *   enforce  400 sin decir qué clave ni por qué.
 *   off      no comprueba.
 *
 * Mira body y query. Los params de ruta son siempre strings, y el cuerpo
 * multipart (multer) se parsea después, dentro de cada router: no pasa por
 * aquí.
 */

const logger = require('../helpers/logger');

const MAX_DEPTH = 20;

const mode = () => String(process.env.NOSQL_INPUT_MODE || 'warn').toLowerCase();

/**
 * Ruta de la primera clave que empieza por `$` (p. ej. "email.$ne"), o null.
 * Recorre objetos y arrays; más allá de MAX_DEPTH niveles lo trata como
 * sospechoso, porque nadie manda 20 niveles de anidamiento legítimo.
 */
function findOperatorKey(value, path = '', depth = 0) {
  if (value === null || typeof value !== 'object') return null;
  if (depth > MAX_DEPTH) return path || '(depth)';
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findOperatorKey(value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const here = path ? `${path}.${key}` : key;
    if (key.startsWith('$')) return here;
    const hit = findOperatorKey(value[key], here, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function rejectMongoOperators(req, res, next) {
  const current = mode();
  if (current === 'off') return next();

  let source = null;
  let key = findOperatorKey(req.body);
  if (key) source = 'body';
  else {
    key = findOperatorKey(req.query);
    if (key) source = 'query';
  }
  if (!key) return next();

  const detail = {
    method: req.method,
    path: req.originalUrl?.split('?')[0] ?? req.path,
    origin: req.headers?.origin,
    ip: req.ip,
    source,
    key,
    reason: `operator in ${source}`,
  };

  if (current === 'enforce') {
    logger.warn(`nosql input: rejected operator in ${source}`, detail);
    return res.status(400).json({ ok: false, msg: 'Invalid input' });
  }
  logger.warn(`nosql input: operator in ${source} allowed (NOSQL_INPUT_MODE=warn)`, detail);
  return next();
}

module.exports = { rejectMongoOperators, findOperatorKey };
