'use strict';

// Carril sin sesión de /api/transaction (y de las rutas de /api/stripe que
// comparten controlador). La app del consumidor (app.devitrak.net) no tiene
// login: lista, guarda y deduplica transacciones sin token. Antes el body iba
// tal cual a Transaction.find() / new Transaction(): `{}` listaba todas las
// transacciones con datos y clientSecret de cualquiera, y cualquier id se
// podía borrar.
//
// El staff con sesión válida sigue igual que siempre. Desde el dashboard sin
// sesión es 401 (isStaffOrigin). El Origin lo puede falsear un script, así que
// lo que protege de verdad es que este carril esté acotado por sí mismo.

const LIST_KEYS = new Set([
  'consumerInfo.email',
  'event_id',
  'company',
  'paymentIntent',
  'active',
  'created_at',
]);
const STRING_KEYS = new Set(['consumerInfo.email', 'event_id', 'company', 'paymentIntent']);
const RANGE_OPS = new Set(['$gte', '$gt', '$lte', '$lt']);

// Con el email del consumidor: sus transacciones, sin el clientSecret (la app
// no lo lee de la lista). Sin email: solo lo que necesita el dedupe de
// DisplayQRCode.jsx, que pide todo el evento para agrupar por paymentIntent.
const OWN_PROJECTION = '-clientSecret';
const DEDUPE_PROJECTION = 'paymentIntent event_id';

class TransactionLaneError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

function parseCreatedAt(value) {
  if (typeof value === 'number') return value;
  if (!isPlainObject(value)) throw new TransactionLaneError(400, 'created_at must be a number or a range');
  const entries = Object.entries(value);
  if (entries.length === 0) throw new TransactionLaneError(400, 'created_at range is empty');
  for (const [op, bound] of entries) {
    if (!RANGE_OPS.has(op) || typeof bound !== 'number') {
      throw new TransactionLaneError(400, 'created_at only accepts $gte/$gt/$lte/$lt with numbers');
    }
  }
  return value;
}

/**
 * @returns {{ filter: object, projection: string }}
 * @throws {TransactionLaneError} 400 con campos/operadores no permitidos o sin
 *   email ni evento (un filtro vacío era "todas las transacciones").
 */
function buildPublicTransactionList(input) {
  const filter = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!LIST_KEYS.has(key)) throw new TransactionLaneError(400, `Unsupported filter: ${key}`);
    if (STRING_KEYS.has(key)) {
      if (!isNonEmptyString(value)) throw new TransactionLaneError(400, `Filter ${key} must be a non-empty string`);
      filter[key] = value;
    } else if (key === 'active') {
      if (typeof value !== 'boolean') throw new TransactionLaneError(400, 'Filter active must be a boolean');
      filter.active = value;
    } else {
      filter.created_at = parseCreatedAt(value);
    }
  }
  if (filter['consumerInfo.email']) return { filter, projection: OWN_PROJECTION };
  if (filter.event_id) return { filter, projection: DEDUPE_PROJECTION };
  throw new TransactionLaneError(400, 'consumerInfo.email or event_id is required');
}

/**
 * Lo que la app manda en POST /save-transaction (devitrak src/classes/Transaction.js).
 * Lo demás se descarta: `type` y `created_at` quedan con sus valores por
 * defecto y `active` siempre es true.
 * @throws {TransactionLaneError} 400 si falta un campo obligatorio.
 */
function buildPublicTransactionDoc(input) {
  const body = isPlainObject(input) ? input : {};
  for (const key of ['paymentIntent', 'clientSecret', 'provider', 'eventSelected', 'event_id', 'company']) {
    if (!isNonEmptyString(body[key])) throw new TransactionLaneError(400, `${key} is required`);
  }
  if (!isPlainObject(body.consumerInfo) || !isNonEmptyString(body.consumerInfo.email)) {
    throw new TransactionLaneError(400, 'consumerInfo.email is required');
  }
  if (!Array.isArray(body.device) || body.device.length === 0 || !body.device.every(isPlainObject)) {
    throw new TransactionLaneError(400, 'device must be a non-empty array of objects');
  }
  return {
    paymentIntent: body.paymentIntent,
    clientSecret: body.clientSecret,
    device: body.device,
    consumerInfo: body.consumerInfo,
    provider: body.provider,
    eventSelected: body.eventSelected,
    event_id: body.event_id,
    company: body.company,
    date: typeof body.date === 'string' ? body.date : new Date().toISOString(),
    active: true,
  };
}

module.exports = {
  buildPublicTransactionList,
  buildPublicTransactionDoc,
  TransactionLaneError,
};
