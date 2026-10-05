'use strict';

const jwt = require('jsonwebtoken');
const { AUDITED_ROUTES } = require('../constants/auditedRoutes');
const { resolveRoute } = require('./requestMetrics');
const { logStaffActivity } = require('../controller/staffActivityLog');
const logger = require('../helpers/logger');

/**
 * Audit trail del lado del servidor: registra en StaffActivityLog cada acción
 * que cambia datos, con su autor, sin depender de que el cliente lo haga.
 *
 * Se monta UNA vez, antes de los routers (index.js), y decide en `finish`,
 * igual que requestMetrics: en ese momento Express ya sabe qué ruta casó y con
 * qué status terminó. Qué se registra lo decide la lista explícita de
 * constants/auditedRoutes.js; lo que no está ahí no se toca.
 *
 * Reglas:
 *   - Solo respuestas correctas (< 400). Un intento fallido no cambió nada.
 *   - El autor sale del JWT. Si la ruta corrió validateJWT, de `req.uid`; si
 *     no (hay rutas de escritura sin auth), se verifica aquí el `x-token` SIN
 *     exigirlo: así se atribuye la acción sin cambiar el contrato de la ruta.
 *     Sin token válido queda `actor_type: 'anonymous'`, no se descarta.
 *   - Nunca rompe la petición: todo corre después de responder y cualquier
 *     error se loguea y se traga. La escritura va por la cola
 *     (logStaffActivity), con reintentos.
 */

const MAX_LIST = 200;
const MAX_DETAIL_BYTES = 4000;

// Claves que nunca se guardan en el log, ni siquiera redactadas a medias.
const SECRET_KEY = /pass(word)?|token|secret|otc|mfa|cvc|cvv|card|iban|ssn|routing|account_?number|authorization/i;

const isPrimitive = (v) => ['string', 'number'].includes(typeof v) && String(v).trim() !== '';
const firstOf = (sources, keys) => {
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const k of keys) if (isPrimitive(src[k])) return String(src[k]);
  }
  return undefined;
};

const SERIAL_KEYS = ['serial_number', 'serialNumber', 'serial', 'device'];
const ITEM_KEYS = ['item_id', 'itemId'];
const LIST_KEYS = [
  'items', 'devices', 'deviceList', 'serials', 'serial_numbers', 'serialNumbers',
  'receivers', 'rows', 'list', 'data', 'members', 'item_ids', 'itemIds', 'ids', 'status',
];

/** Seriales e item_ids de la petición, vengan sueltos o dentro de listas. */
function collectIds(body) {
  const serials = new Set();
  const items = new Set();
  const visit = (v, depth) => {
    if (depth > 3 || serials.size >= MAX_LIST) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (!v || typeof v !== 'object') return;
    for (const k of SERIAL_KEYS) if (isPrimitive(v[k])) serials.add(String(v[k]));
    for (const k of ITEM_KEYS) if (isPrimitive(v[k])) items.add(String(v[k]));
    for (const k of LIST_KEYS) if (v[k] && typeof v[k] === 'object') visit(v[k], depth + 1);
  };
  visit(body, 0);
  // Listas planas de seriales: `serials: ["A1","A2"]`.
  for (const k of ['serials', 'serial_numbers', 'serialNumbers', 'devices']) {
    if (Array.isArray(body?.[k])) body[k].filter(isPrimitive).forEach((s) => serials.add(String(s)));
  }
  for (const k of ['item_ids', 'itemIds']) {
    if (Array.isArray(body?.[k])) body[k].filter(isPrimitive).forEach((s) => items.add(String(s)));
  }
  return {
    serial_numbers: [...serials].slice(0, MAX_LIST),
    item_ids: [...items].slice(0, MAX_LIST),
  };
}

/** Cuántos elementos tocó la acción: el array más largo del body. */
function countOf(body) {
  if (Array.isArray(body)) return body.length;
  let max = 0;
  for (const v of Object.values(body || {})) if (Array.isArray(v)) max = Math.max(max, v.length);
  return max || undefined;
}

/** Contexto filtrable: evento, dispositivo, member, consumidor. */
function extractContext(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const sources = [req.params, body, req.query];
  const ctx = {
    event_id: firstOf(sources, ['event_id', 'eventId', 'event_sql_id']),
    event_name: firstOf(sources, ['event_name', 'eventName', 'event']),
    member_id: firstOf(sources, ['member_id', 'memberId']),
    consumer: firstOf(sources, ['consumer', 'consumer_id', 'consumerId', 'userId', 'user']),
    ...collectIds(body),
    count: countOf(body),
  };
  const single = firstOf(sources, SERIAL_KEYS);
  if (single && !ctx.serial_numbers.includes(single)) ctx.serial_numbers.unshift(single);
  const singleItem = firstOf(sources, ITEM_KEYS);
  if (singleItem && !ctx.item_ids.includes(singleItem)) ctx.item_ids.unshift(singleItem);
  for (const k of Object.keys(ctx)) {
    if (ctx[k] === undefined || (Array.isArray(ctx[k]) && ctx[k].length === 0)) delete ctx[k];
  }
  return ctx;
}

/** Copia del body sin secretos, con listas recortadas y tamaño acotado. */
function sanitize(value, depth = 0) {
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) {
    const out = value.slice(0, 20).map((v) => sanitize(v, depth + 1));
    if (value.length > 20) out.push(`[+${value.length - 20} more]`);
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
  return value;
}

function boundedRequest(body) {
  if (body === undefined || body === null) return undefined;
  const clean = sanitize(body);
  const text = JSON.stringify(clean);
  if (text && text.length > MAX_DETAIL_BYTES) {
    return { truncated: true, keys: Object.keys(clean || {}) };
  }
  return clean;
}

/** id del objeto afectado: el de la URL, o el que devolvió la respuesta. */
function targetIdOf(req, resBody) {
  const p = req.params || {};
  const fromParams = Object.values(p).find(isPrimitive);
  if (fromParams) return String(fromParams);
  const r = resBody && typeof resBody === 'object' ? resBody : {};
  const fromRes =
    r.insertId ?? r.id ?? r._id ?? r.memberId ?? r.result?.insertId ?? r.data?.insertId ?? r.data?.id;
  return isPrimitive(fromRes) ? String(fromRes) : undefined;
}

const defaultVerify = (token) => jwt.verify(token, process.env.SECRET_JWT_SEED);

/** Autor: el uid que dejó validateJWT, o el del x-token verificado aquí. */
function resolveActor(req, verifyToken) {
  if (req.uid) return String(req.uid);
  const token = typeof req.header === 'function' ? req.header('x-token') : req.headers?.['x-token'];
  if (!token) return null;
  try {
    const { uid } = verifyToken(token);
    return uid ? String(uid) : null;
  } catch {
    return null;
  }
}

const header = (req, name) =>
  (typeof req.header === 'function' ? req.header(name) : req.headers?.[name]) || null;

function buildEntry(req, res, spec, { verifyToken = defaultVerify } = {}) {
  const actor = resolveActor(req, verifyToken);
  const resBody = res.locals?.auditResponseBody;
  return {
    staff_member_id: actor,
    actor_type: actor ? 'staff' : 'anonymous',
    // Mongo id de la compañía si viene; si no, el id SQL que manda el dashboard
    // a /api/db_*. El worker traduce el SQL a Mongo (queue/handlers/staffActivityLog.js).
    company_id: header(req, 'x-company-id'),
    company_sql_id: header(req, 's-company-lq'),
    action: spec.action,
    target_model: spec.target_model,
    target_id: targetIdOf(req, resBody),
    context: extractContext(req),
    details: {
      route: `${req.method} ${resolveRoute(req)}`,
      status: res.statusCode,
      request: boundedRequest(req.body),
    },
    source: 'server',
    ip_address: req.ip,
    device_info: header(req, 'user-agent') || '',
  };
}

const createAuditTrail = ({
  registry = AUDITED_ROUTES,
  logFn = logStaffActivity,
  verifyToken = defaultVerify,
} = {}) => (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  // La respuesta trae a veces el único id del objeto creado (insertId).
  const json = res.json;
  if (typeof json === 'function') {
    res.json = function auditJson(body) {
      if (res.locals) res.locals.auditResponseBody = body;
      return json.call(this, body);
    };
  }

  res.on('finish', () => {
    try {
      if (res.statusCode >= 400) return;
      const spec = registry[`${req.method} ${resolveRoute(req)}`];
      if (!spec) return;
      Promise.resolve(logFn(buildEntry(req, res, spec, { verifyToken }))).catch((err) =>
        logger.error('audit trail: could not enqueue entry', { err: err?.message }),
      );
    } catch (err) {
      logger.error('audit trail: could not build entry', { err: err?.message });
    }
  });
  next();
};

const auditTrail = createAuditTrail();

module.exports = { auditTrail, createAuditTrail, buildEntry, extractContext, sanitize };
