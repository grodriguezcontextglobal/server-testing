'use strict';

/**
 * Rellena `summary`, `target_label` y `actor` en los registros del audit trail
 * escritos antes de que existieran (2026-10-05). Usa la misma lógica que el
 * worker (queue/handlers/staffActivityLog.js), así que el resultado es el que
 * tendrían de haberse escrito hoy.
 *
 *   node scripts/backfill-audit-summaries.js                       # solo muestra qué haría
 *   node scripts/backfill-audit-summaries.js --apply               # escribe
 *   node scripts/backfill-audit-summaries.js --since=2026-10-05    # solo desde esa fecha
 *
 * Solo toca registros SIN `summary`; correrlo dos veces no cambia nada.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { describeEntry } = require('../helpers/auditDescribe');
const { enrichContext } = require('../queue/handlers/staffActivityLog');

const APPLY = process.argv.includes('--apply');

// Mismas listas que cuenta middlewares/auditTrail.js (COUNT_KEYS). El body
// guardado recorta las listas a 20 y añade "[+N more]".
const COUNT_KEYS = [
  'items', 'devices', 'deviceList', 'serials', 'serial_numbers', 'serialNumbers',
  'receivers', 'rows', 'list', 'data', 'members', 'item_ids', 'itemIds', 'ids', 'units',
];
function countFromRequest(req) {
  let max = 0;
  for (const k of COUNT_KEYS) {
    const v = req[k];
    if (!Array.isArray(v)) continue;
    const more = typeof v[v.length - 1] === 'string' && /^\[\+(\d+) more\]$/.exec(v[v.length - 1]);
    max = Math.max(max, more ? v.length - 1 + Number(more[1]) : v.length);
  }
  return max;
}
// --since=2026-10-05T00:00:00Z limita a los registros desde esa fecha.
const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const SINCE = sinceArg ? new Date(sinceArg.slice('--since='.length)) : null;
if (SINCE && Number.isNaN(SINCE.getTime())) {
  console.error('--since no es una fecha válida');
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.DB_CNN, { serverSelectionTimeoutMS: 30000 });
  const StaffActivityLog = require('../models/StaffActivityLog');
  const AdminUser = require('../models/AdminUser');
  const Receivers = require('../models/Receivers');
  const ReceiversPool = require('../models/ReceiversPool');

  const finders = {
    findReceiver: (id) => Receivers.findById(id).select('user eventSelected event_id device').lean(),
    findPoolEntry: (id) => ReceiversPool.findById(id).select('eventSelected device').lean(),
  };

  const filter = { summary: { $exists: false }, ...(SINCE ? { timestamp: { $gte: SINCE } } : {}) };
  const cursor = StaffActivityLog.find(filter).sort({ timestamp: 1 }).lean().cursor();
  let seen = 0;
  let written = 0;
  for await (const doc of cursor) {
    seen++;
    let context = await enrichContext(doc, finders).catch(() => doc.context);
    // El `count` de los registros viejos contaba CUALQUIER array del body
    // ("Updated 2 companies" al editar una). Se recalcula con la regla actual.
    if (context && doc.details?.request && typeof doc.details.request === 'object') {
      const count = countFromRequest(doc.details.request);
      context = { ...context };
      if (count > 1) context.count = count;
      else delete context.count;
    }
    let targetLabel = doc.target_label;
    if (!targetLabel && doc.target_model === 'AdminUser' && doc.target_id &&
        String(doc.target_id) !== String(doc.staff_member_id || '')) {
      const t = await AdminUser.findById(doc.target_id).select('email').lean().catch(() => null);
      targetLabel = t?.email;
    }
    const entry = { ...doc, context, ...(targetLabel ? { target_label: targetLabel } : {}) };
    const { summary, target_label, action, target_model } = describeEntry(entry);

    let actor = doc.actor;
    if (!actor && doc.staff_member_id) {
      const u = await AdminUser.findById(doc.staff_member_id).select('name lastName email').lean().catch(() => null);
      if (u) actor = { name: [u.name, u.lastName].filter(Boolean).join(' ').trim(), email: u.email };
    }

    const $set = { summary, ...(target_label ? { target_label } : {}), ...(actor ? { actor } : {}) };
    if (context) $set.context = context;
    if (action && action !== doc.action) $set.action = action;
    if (target_model && target_model !== doc.target_model) $set.target_model = target_model;

    console.log(`${doc.timestamp?.toISOString?.() || ''}  ${doc.action} ${doc.target_model} → ${summary}`);
    if (APPLY) {
      await StaffActivityLog.updateOne({ _id: doc._id, summary: { $exists: false } }, { $set });
      written++;
    }
  }

  console.log(`\n${seen} registros sin frase; ${APPLY ? `${written} actualizados` : 'nada escrito (usa --apply)'}`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('FAILED', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
