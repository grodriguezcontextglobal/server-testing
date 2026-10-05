'use strict';

/**
 * Rellena `summary`, `target_label` y `actor` en los registros del audit trail
 * escritos antes de que existieran (2026-10-05). Usa la misma lógica que el
 * worker (queue/handlers/staffActivityLog.js), así que el resultado es el que
 * tendrían de haberse escrito hoy.
 *
 *   node scripts/backfill-audit-summaries.js           # solo muestra qué haría
 *   node scripts/backfill-audit-summaries.js --apply   # escribe
 *
 * Solo toca registros SIN `summary`; correrlo dos veces no cambia nada.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { describeEntry } = require('../helpers/auditDescribe');
const { enrichContext } = require('../queue/handlers/staffActivityLog');

const APPLY = process.argv.includes('--apply');

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

  const cursor = StaffActivityLog.find({ summary: { $exists: false } }).lean().cursor();
  let seen = 0;
  let written = 0;
  for await (const doc of cursor) {
    seen++;
    const context = await enrichContext(doc, finders).catch(() => doc.context);
    const entry = { ...doc, context };
    const { summary, target_label, action } = describeEntry(entry);

    let actor = doc.actor;
    if (!actor && doc.staff_member_id) {
      const u = await AdminUser.findById(doc.staff_member_id).select('name lastName email').lean().catch(() => null);
      if (u) actor = { name: [u.name, u.lastName].filter(Boolean).join(' ').trim(), email: u.email };
    }

    const $set = { summary, ...(target_label ? { target_label } : {}), ...(actor ? { actor } : {}) };
    if (context) $set.context = context;
    if (action && action !== doc.action) $set.action = action;

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
