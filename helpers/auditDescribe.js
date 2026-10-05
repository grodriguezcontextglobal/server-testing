'use strict';

/**
 * Convierte un registro del audit trail en una frase legible: qué se hizo,
 * sobre qué y sobre quién. El autor no va en la frase (lo pinta el reporte con
 * `actor`), así que la frase empieza por el verbo:
 *
 *   "Returned device SN-100006 from ana@x.com at event TEST _ 2"
 *   "Sent device assignment notification email to ana@x.com"
 *   "Checked out of the warehouse 3 devices (SN-1, SN-2, SN-3)"
 *
 * En inglés, como el dashboard. Función pura: recibe el registro ya
 * enriquecido (queue/handlers/staffActivityLog.js) y devuelve
 * { summary, target_label, action? }. `action` solo viene cuando la ruta es
 * ambigua y el contenido decide el verbo real (receiver-update sirve para
 * asignar y para devolver).
 */

const VERB = {
  ASSIGN: 'Assigned',
  UNASSIGN: 'Unassigned',
  RETURN: 'Returned',
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  IMPORT: 'Imported',
  EXPORT: 'Exported',
  CHECK_OUT: 'Checked out',
  RESERVE: 'Reserved',
  RELEASE: 'Released',
  MOVE: 'Moved',
  CHARGE: 'Charged',
  CAPTURE: 'Captured',
  CANCEL: 'Cancelled',
  REFUND: 'Refunded',
  SETTLE: 'Settled',
  SEND: 'Sent',
  RESPOND: 'Responded to',
  SIGN: 'Signed',
  UPLOAD: 'Uploaded',
  ERASE: 'Erased',
  CLOSE: 'Closed',
  RECONCILE: 'Reconciled',
  ACCEPT: 'Accepted',
  CLEAR: 'Cleared',
  OPEN: 'Opened',
  LOGIN: 'Logged in',
  LOGOUT: 'Logged out',
  FORCE_LOGOUT: 'Ended the active session of',
};

const MODEL = {
  AdminUser: 'staff account',
  User: 'consumer account',
  Event: 'event',
  Inventory: 'inventory',
  Transaction: 'transaction',
  Lease: 'lease',
  Member: 'member',
  Guardian: 'guardian',
  Consent: 'consent',
  Fee: 'fee',
  Verification: 'signature request',
  Company: 'company',
  Device: 'device',
  Staff: 'staff member',
  Consumer: 'consumer',
  Item: 'item',
  Container: 'container',
  Category: 'category',
  Group: 'group',
  Location: 'location',
  SubLocation: 'sub-location',
  Shipment: 'shipment',
  Subscription: 'subscription',
  CashReport: 'cash report',
  Document: 'document',
  Folder: 'folder',
  Signature: 'signature',
  Provider: 'provider',
  Email: 'email',
  Invitation: 'invitation',
  Terms: 'terms and conditions',
  Identifier: 'identifier',
  StripeAccount: 'Stripe account',
  StripeLink: 'Stripe link',
  Image: 'image',
  Post: 'post',
  Article: 'article',
  Feedback: 'feedback',
  Task: 'task',
  Cache: 'cached data',
};

const SHOW_SERIALS = 3;

// Nombre legible de los correos más usados (la ruta lleva el error de tipeo
// "assignig" en producción). El resto se deriva de la ruta.
const EMAIL_KIND = {
  'assignig-device-notification': 'device assignment',
  'confirm-returned-device-notification': 'device return confirmation',
  'device-report-per-transaction': 'device report',
  'deposit-collected-notification': 'deposit collected',
  'deposit-return-notification': 'deposit returned',
  'refund-notification': 'refund receipt',
  'invoice-notification': 'invoice',
  'new_invitation': 'staff invitation',
  'reset-admin-password': 'password reset',
  'forcing-revoking-active-session': 'end active session',
  'lost-device-fee-notification': 'lost device fee',
};

const routePath = (entry) => String(entry?.details?.route || '').split(' ')[1] || '';
const lastSegment = (entry) => routePath(entry).split('/').filter(Boolean).pop() || '';
const humanize = (slug) => slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

/** company → companies, device → devices; el inventario se cuenta en items. */
function plural(noun, { inventory = 'items' } = {}) {
  if (noun === 'inventory') return inventory;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

/** "device SN-1" / "3 devices (SN-1, SN-2, SN-3)" / "5 inventory items". */
function objectPhrase(entry, noun) {
  const ctx = entry.context || {};
  const serials = ctx.serial_numbers || [];
  if (serials.length === 1) return `${noun} ${serials[0]}`;
  if (serials.length > 1) {
    const shown = serials.slice(0, SHOW_SERIALS).join(', ');
    const more = serials.length > SHOW_SERIALS ? `, +${serials.length - SHOW_SERIALS} more` : '';
    return `${serials.length} ${plural(noun)} (${shown}${more})`;
  }
  if (ctx.count > 1) return `${ctx.count} ${plural(noun, { inventory: 'inventory items' })}`;
  const label =
    entry.target_label ||
    (PERSON_MODELS.has(entry.target_model) ? emailIn(entry.details?.request) : nameIn(entry.details?.request));
  if (label) return `${noun} ${label}`;
  const id = entry.target_id || (PERSON_MODELS.has(entry.target_model) ? personIdIn(entry.details?.request) : undefined);
  if (id) return `${noun} #${id}`;
  return noun;
}

/** " to ana@x.com" / " from ana@x.com" / " for member 9". */
function personPhrase(entry, action) {
  const ctx = entry.context || {};
  const who = ctx.consumer || (ctx.member_id ? `member #${ctx.member_id}` : null);
  if (!who) return '';
  if (action === 'ASSIGN' || action === 'CHECK_OUT') return ` to ${who}`;
  if (action === 'RETURN' || action === 'UNASSIGN') return ` from ${who}`;
  return ` for ${who}`;
}

// Inventario que entra o sale de un evento: "to event", "from event", "for
// event". Lo demás pasa "at event" (devolver un equipo en el evento).
const EVENT_PREP = {
  ASSIGN: 'to',
  RESERVE: 'for',
  CHECK_OUT: 'for',
  UNASSIGN: 'from',
  RELEASE: 'from',
};

function eventPhrase(entry, action) {
  const ctx = entry.context || {};
  const name = ctx.event_name || (ctx.event_id ? `#${ctx.event_id}` : null);
  if (!name) return '';
  const prep = entry.target_model === 'Inventory' ? EVENT_PREP[action] || 'at' : 'at';
  return ` ${prep} event ${name}`;
}

/** Rutas cuyo significado real depende del contenido, no del nombre. */
const SPECIAL = [
  {
    // Asignar y devolver usan la misma ruta; `device.status` decide.
    test: (e) => /\/api\/(receiver|admin)\/receiver-update\/:id$/.test(routePath(e)),
    describe: (e) => {
      const status = e.details?.request?.device?.status;
      const action = status === false ? 'RETURN' : status === true ? 'ASSIGN' : e.action;
      return { action };
    },
  },
  {
    // El pool del evento: `activity` dice si el equipo quedó en uso o libre.
    test: (e) => /\/receivers-pool-update\/:id$/.test(routePath(e)),
    describe: (e) => {
      const activity = e.details?.request?.activity;
      if (activity === undefined) return {};
      const state = activity ? 'in use' : 'available';
      return { summary: `Marked ${objectPhrase(e, 'device')} as ${state} in the pool${eventPhrase(e, e.action)}` };
    },
  },
  {
    test: (e) => /^\/api\/nodemailer\//.test(routePath(e)),
    describe: (e) => {
      const slug = lastSegment(e);
      const kind = EMAIL_KIND[slug] || humanize(slug.replace(/[-_]?(email[-_]?)?notification$/, ''));
      const to = (e.context?.recipients || []).slice(0, 3).join(', ');
      const more = (e.context?.recipients || []).length > 3 ? ' and others' : '';
      return { summary: `Sent ${kind ? `"${kind}" ` : ''}email${to ? ` to ${to}${more}` : ''}` };
    },
  },
  {
    // Registros previos al 2026-10-05 dicen "CREATE StripeLink": se corrigen al
    // describirlos.
    test: (e) => /\/api\/stripe\/account_(sessions|link)$/.test(routePath(e)),
    describe: (e) => ({
      action: 'OPEN',
      target_model: 'StripeAccount',
      summary: `Opened the Stripe payments dashboard${e.target_id ? ` (account ${e.target_id})` : ''}`,
    }),
  },
  {
    // El autor editando su propia cuenta (PATCH /api/admin/profile/:id).
    test: (e) =>
      e.target_model === 'AdminUser' &&
      e.action === 'UPDATE' &&
      e.target_id &&
      e.staff_member_id &&
      String(e.target_id) === String(e.staff_member_id),
    describe: () => ({ summary: 'Updated their own profile' }),
  },
  {
    // Cerrar la propia sesión abierta en otro sitio (pantalla de login).
    test: (e) =>
      e.action === 'FORCE_LOGOUT' &&
      e.target_id &&
      e.staff_member_id &&
      String(e.target_id) === String(e.staff_member_id),
    describe: () => ({ summary: 'Ended their own active session elsewhere' }),
  },
  {
    // La llama el dashboard sola después de cada acción: se registra, pero se
    // dice que es automática para que no parezca una acción de la persona.
    test: (e) => /\/api\/cache_update\/remove-cache$/.test(routePath(e)),
    describe: () => ({ summary: 'Refreshed cached data (automatic, after an action)' }),
  },
];

const PERSON_MODELS = new Set(['Staff', 'AdminUser', 'Member', 'Consumer', 'User', 'Guardian']);
const emailIn = (req) => {
  if (!req || typeof req !== 'object') return undefined;
  const v = ['email', 'staff_email', 'staffEmail', 'member_email', 'user'].map((k) => req[k])
    .find((x) => typeof x === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.trim()));
  return v ? v.trim() : undefined;
};

// Nombre legible del objeto (compañía, evento, documento…) si el body lo trae.
const nameIn = (req) => {
  if (!req || typeof req !== 'object') return undefined;
  const v = ['company_name', 'event_name', 'document_name', 'title', 'name']
    .map((k) => req[k]).find((x) => typeof x === 'string' && x.trim());
  return v ? v.trim().slice(0, 80) : undefined;
};

const personIdIn = (req) => {
  if (!req || typeof req !== 'object') return undefined;
  const v = ['staff_id', 'staffId', 'member_id', 'memberId', 'consumer_id', 'user_id', 'userId']
    .map((k) => req[k]).find((x) => (typeof x === 'string' && x) || typeof x === 'number');
  return v !== undefined ? String(v) : undefined;
};

function describeEntry(entry) {
  const special = SPECIAL.find((s) => s.test(entry));
  const override = special ? special.describe(entry) || {} : {};
  const action = override.action || entry.action;

  // En login/logout el objeto es la propia cuenta del autor: no hay "sobre qué".
  const selfAction = ['LOGIN', 'LOGOUT'].includes(action);
  // Registros anteriores a target_label: si la acción es sobre una persona, su
  // email suele estar en el body guardado.
  const personEmail = PERSON_MODELS.has(entry.target_model) ? emailIn(entry.details?.request) : undefined;
  const target_label = selfAction ? undefined :
    entry.target_label ||
    personEmail ||
    (entry.context?.serial_numbers?.length === 1 ? entry.context.serial_numbers[0] : undefined) ||
    entry.context?.consumer ||
    entry.target_id ||
    undefined;

  const corrections = {
    ...(override.action ? { action } : {}),
    ...(override.target_model ? { target_model: override.target_model } : {}),
  };
  if (override.summary) return { summary: override.summary, target_label, ...corrections };

  const verb = VERB[action] || humanize(String(action || 'Acted on')).toLowerCase();
  const noun = MODEL[entry.target_model] || humanize(String(entry.target_model || 'record')).toLowerCase();

  let summary;
  if (action === 'LOGIN' || action === 'LOGOUT') {
    summary = verb;
  } else if (action === 'FORCE_LOGOUT') {
    summary = `${verb} ${entry.target_label || entry.context?.consumer || `staff #${entry.target_id || '?'}`}`;
  } else {
    const fromWarehouse = action === 'CHECK_OUT' ? ' from the warehouse' : '';
    summary = `${verb} ${objectPhrase(entry, noun)}${fromWarehouse}${personPhrase(entry, action)}${eventPhrase(entry, action)}`;
  }
  if (entry.details?.inferred) summary += ' (unclassified action)';

  return { summary, target_label, ...corrections };
}

module.exports = { describeEntry, VERB, MODEL };
