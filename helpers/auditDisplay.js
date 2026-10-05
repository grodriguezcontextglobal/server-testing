'use strict';

/**
 * Desglose de un registro del audit trail para pintarlo en el cliente sin
 * interpretar nada: quién, qué, cómo, a quién, dónde y cuándo.
 *
 *   display: {
 *     who:   { name, email, kind },                 // kind: staff | anonymous
 *     what:  { action, verb, object, model },       // "Returned" + "device SN-100006"
 *     how:   { method, endpoint, operation, fields: [{ label, value }] },
 *     whom:  { kind, label } | null,                // consumer | member | staff | recipients
 *     where: { event, company } | null,
 *     when:  ISO-8601,
 *   }
 *
 * `how.fields` sale del PAYLOAD de la petición: cada campo con nombre legible
 * y valor formateado ("Device › Serial number: SN-100006"). Así el detalle de
 * QUÉ se cambió viene de lo que se mandó, no de una interpretación. Se omiten
 * ids técnicos, timestamps del cliente y credenciales (que el middleware ya
 * redacta antes de guardar).
 *
 * Función pura: el worker (queue/handlers/staffActivityLog.js) y el backfill
 * la llaman con el registro ya enriquecido y descrito.
 */

const { VERB, MODEL } = require('./auditDescribe');

const MAX_FIELDS = 15;
const MAX_LIST = 5;

// Nombres legibles de los campos más comunes de los payloads del dashboard.
const LABEL = {
  serialNumber: 'Serial number',
  serial_number: 'Serial number',
  deviceType: 'Device type',
  deviceValue: 'Device value',
  device: 'Device',
  status: 'Status',
  activity: 'In use',
  eventSelected: 'Event',
  event_name: 'Event',
  event_id: 'Event ID',
  paymentIntent: 'Payment intent',
  user: 'Consumer',
  consumer: 'Consumer',
  email: 'Email',
  provider: 'Provider',
  comment: 'Comment',
  contract_type: 'Contract type',
  type: 'Type',
  item_group: 'Item group',
  category_name: 'Category',
  location: 'Location',
  sub_location: 'Sub-location',
  warehouse: 'In warehouse',
  condition: 'Condition',
  role: 'Role',
  active: 'Active',
  total: 'Amount',
  amount: 'Amount',
  first_name: 'First name',
  last_name: 'Last name',
  name: 'Name',
  lastName: 'Last name',
  phone: 'Phone',
  phone_number: 'Phone',
  title: 'Title',
  description: 'Description',
  connectedAccountId: 'Stripe account',
  company_name: 'Company name',
  minor: 'Minor',
  grade: 'Grade',
  homeroom: 'Homeroom',
  expected_return_date: 'Expected return date',
  returned_date: 'Returned date',
  return_status: 'Return status',
  condition_note: 'Condition note',
};

// Campos que no dicen nada a quien lee el trail: ids internos, contexto que ya
// está en otra sección, sellos de tiempo del cliente.
const SKIP = /^(id|_id|__v|company|company_id|companyId|company_sql_id|staff_id|staffId|sqlStaffId|admin_id|uid|timeStamp|timestamp|createdAt|updatedAt|x-.*|key)$/;

// "firstName" / "first_name" → "First name": solo la primera mayúscula, como
// el resto de etiquetas del dashboard.
const humanizeKey = (k) =>
  LABEL[k] ||
  k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.slice(0, 16).replace('T', ' ');
    return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  return null; // objetos y listas los resuelve fieldsOf
}

// Valores cuyo significado depende de la ruta. En receiver-update,
// `device.status` false/true es devolver/asignar, no "No"/"Yes".
const VALUE_BY_ROUTE = [
  {
    route: /receiver-update\/:id$/,
    label: 'Device › Status',
    map: (v) => (v === false ? 'Returned' : v === true ? 'Assigned' : undefined),
  },
];

/** El payload guardado, aplanado a [{ label, value }] legibles. */
function fieldsOf(request, route) {
  const routeRules = VALUE_BY_ROUTE.filter((r) => r.route.test(String(route || '')));
  const valueFor = (label, v) => {
    const rule = routeRules.find((r) => r.label === label);
    const mapped = rule ? rule.map(v) : undefined;
    return mapped !== undefined ? mapped : formatValue(v);
  };
  const out = [];
  const walk = (obj, prefix, depth) => {
    if (!obj || typeof obj !== 'object' || out.length >= MAX_FIELDS) return;
    for (const [k, v] of Object.entries(obj)) {
      if (out.length >= MAX_FIELDS) return;
      if (SKIP.test(k) || v === '[redacted]') continue;
      const label = prefix ? `${prefix} › ${humanizeKey(k)}` : humanizeKey(k);
      if (Array.isArray(v)) {
        const prims = v.filter((x) => ['string', 'number', 'boolean'].includes(typeof x));
        if (prims.length === v.length) {
          const shown = prims.slice(0, MAX_LIST).map(formatValue).join(', ');
          const more = prims.length > MAX_LIST ? ` (+${prims.length - MAX_LIST} more)` : '';
          if (shown) out.push({ label, value: `${shown}${more}` });
        } else {
          out.push({ label, value: `${v.length} ${v.length === 1 ? 'entry' : 'entries'}` });
        }
      } else if (v && typeof v === 'object') {
        if (depth < 2) walk(v, label, depth + 1);
      } else {
        out.push({ label, value: valueFor(label, v) });
      }
    }
  };
  walk(request && typeof request === 'object' ? request : {}, '', 0);
  return out;
}

/** "PATCH /api/receiver/receiver-update/:id" → método, endpoint y "Receiver update". */
function routeParts(route) {
  const text = String(route || '');
  const [method, path] = text.includes(' ') ? text.split(' ') : [undefined, text];
  const segments = String(path || '').split('/').filter((s) => s && !s.startsWith(':') && s !== 'api');
  const last = segments[segments.length - 1] || '';
  const operation = last
    .replace(/^db_/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\bassignig\b/, 'assigning')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
  return { method, endpoint: path || undefined, operation: operation || undefined };
}

/** Sobre quién recayó la acción, si fue sobre una persona. */
function whomOf(entry) {
  const ctx = entry.context || {};
  if (entry.target_model === 'Email' && ctx.recipients?.length) {
    return { kind: 'recipients', label: ctx.recipients.join(', ') };
  }
  if (ctx.consumer) return { kind: 'consumer', label: ctx.consumer };
  if (ctx.member_id) return { kind: 'member', label: `#${ctx.member_id}` };
  if (['Staff', 'AdminUser'].includes(entry.target_model)) {
    const self = entry.target_id && String(entry.target_id) === String(entry.staff_member_id || '');
    const req = entry.details?.request || {};
    const fromBody = req.staff_id ?? req.staffId;
    const label = entry.target_label || (fromBody !== undefined ? `#${fromBody}` : undefined);
    return self || !label ? null : { kind: 'staff', label };
  }
  if (['Member', 'Consumer', 'User', 'Guardian'].includes(entry.target_model) && entry.target_label) {
    return { kind: entry.target_model.toLowerCase(), label: entry.target_label };
  }
  return null;
}

/**
 * @param {object} entry  registro ya enriquecido, con summary/target_label/action.
 * @param {object} [opts]
 * @param {string} [opts.companyName]  nombre de la compañía (el worker lo busca).
 * @param {string} [opts.verb]  verbo de la frase (describeEntry), para que el
 *   desglose y la frase digan lo mismo ("Marked", no "Updated").
 * @param {string} [opts.object]  objeto de la frase SIN a quién ni dónde: esos
 *   van en `whom` y `where`, y repetirlos aquí ensucia la vista.
 */
function buildDisplay(entry, { companyName, verb: givenVerb, object: givenObject } = {}) {
  const action = entry.action;
  const noun = MODEL[entry.target_model] || String(entry.target_model || 'record').toLowerCase();
  const ctx = entry.context || {};

  const verb = givenVerb || VERB[action] || action;
  const object = givenObject || (entry.target_label ? `${noun} ${entry.target_label}` : noun);

  const event = ctx.event_name || (ctx.event_id ? `#${ctx.event_id}` : undefined);
  const where = event || companyName ? { ...(event ? { event } : {}), ...(companyName ? { company: companyName } : {}) } : null;

  return {
    who: {
      ...(entry.actor?.name ? { name: entry.actor.name } : {}),
      ...(entry.actor?.email ? { email: entry.actor.email } : {}),
      kind: entry.actor_type || (entry.staff_member_id ? 'staff' : 'anonymous'),
    },
    what: { action, verb, object, model: entry.target_model },
    how: {
      ...routeParts(entry.details?.route),
      fields: fieldsOf(entry.details?.request, entry.details?.route),
    },
    whom: whomOf(entry),
    where,
    when: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString(),
  };
}

module.exports = { buildDisplay, fieldsOf, routeParts };
