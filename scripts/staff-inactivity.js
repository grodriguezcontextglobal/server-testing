'use strict';

/**
 * Cuentas de staff inactivas (AC-2(3), 2026-11-09): informe, relleno inicial de
 * lastLoginAt y reactivación. El barrido diario es scheduler/staffInactivity.js.
 *
 *   node scripts/staff-inactivity.js --report
 *       Todas las cuentas: activa o no, último login (fecha e IP), número de
 *       logins, último login fallido, último cambio de contraseña, días de
 *       inactividad y si el barrido la desactivaría con la configuración
 *       actual (.env). Solo lee.
 *
 *   node scripts/staff-inactivity.js --backfill [--dry-run]
 *       lastLoginAt no existía antes del 2026-11-09. Lo rellena con el último
 *       LOGIN real de cada cuenta en el audit trail (StaffActivityLog), solo
 *       donde falta o es más antiguo. Opcional: la inactividad cuenta desde
 *       STAFF_INACTIVITY_SINCE (2026-11-09) como mínimo, así que esas fechas
 *       anteriores no desactivan a nadie; sirven para el informe.
 *
 *   node scripts/staff-inactivity.js --reactivate <email> --by <super_user email> [--dry-run]
 *       Vuelve a activar una cuenta. reactivatedAt da otros
 *       STAFF_INACTIVITY_DAYS para entrar. Queda como REACTIVATE en el audit trail.
 */

const { inactivityConfig, lastActivityOf, findInactive, createdAtOf } = require('../scheduler/staffInactivity');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');

/** Filas del informe, ordenadas de más a menos días de inactividad (testeable). */
function reportRows(users, { now = new Date(), days, exempt, since = null }) {
  const flagged = new Set(findInactive(users, { now, days, exempt, since }).inactive.map((r) => String(r.user._id)));
  return users
    .map((u) => {
      const last = lastActivityOf(u, since);
      return {
        email: u.email,
        active: u.active !== false,
        super_user: Boolean(u.super_user),
        created: day(createdAtOf(u)),
        last_login: day(u.lastLoginAt),
        last_login_ip: u.lastLoginIp || '-',
        logins: u.loginCount ?? 0,
        last_failed: day(u.lastFailedLoginAt),
        password_changed: day(u.passwordChangedAt),
        days_inactive: last ? Math.floor((now - last) / 86400000) : null,
        would_disable: flagged.has(String(u._id)),
        exempt: exempt.has(String(u.email || '').toLowerCase()),
        deactivated: u.active === false ? `${day(u.deactivatedAt)} ${u.deactivatedReason || ''}`.trim() : '',
      };
    })
    .sort((a, b) => (b.days_inactive ?? -1) - (a.days_inactive ?? -1));
}

/**
 * Qué lastLoginAt poner desde el audit trail (testeable).
 * @param users      [{ _id, email, lastLoginAt }]
 * @param lastLogins Map(uid string -> Date) del último LOGIN en StaffActivityLog
 * @returns [{ _id, email, from, to }]
 */
function backfillPlan(users, lastLogins) {
  const plan = [];
  for (const u of users) {
    const fromLog = lastLogins.get(String(u._id));
    if (!fromLog) continue;
    const current = u.lastLoginAt ? new Date(u.lastLoginAt) : null;
    if (current && current >= fromLog) continue;
    plan.push({ _id: u._id, email: u.email, from: current, to: fromLog });
  }
  return plan;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();
  const AdminUser = require('../models/AdminUser');
  const dryRun = process.argv.includes('--dry-run');
  const cfg = inactivityConfig();

  try {
    if (process.argv.includes('--report')) {
      const users = await AdminUser.find({})
        .select(
          'email active super_user lastLoginAt +lastLoginIp loginCount lastFailedLoginAt passwordChangedAt ' +
            'reactivatedAt deactivatedAt deactivatedReason'
        )
        .lean();
      const rows = reportRows(users, { days: cfg.days, exempt: cfg.exempt, since: cfg.since });
      console.log(
        `STAFF_INACTIVITY_MODE=${cfg.mode}  DAYS=${cfg.days}  SINCE=${day(cfg.since)}  exempt=${[...cfg.exempt].join(',') || '-'}`
      );
      console.log(`(usage is recorded from ${day(cfg.since)}; "-" = nothing recorded since then)`);
      console.table(rows);
      const active = rows.filter((r) => r.active).length;
      const flagged = rows.filter((r) => r.would_disable).length;
      const noLogin = rows.filter((r) => r.active && r.last_login === '-').length;
      console.log(`${rows.length} accounts, ${active} active; ${flagged} would be disabled; ${noLogin} active without a login since ${day(cfg.since)} (optional: --backfill for older logins)`);
      return;
    }

    if (process.argv.includes('--backfill')) {
      const StaffActivityLog = require('../models/StaffActivityLog');
      const agg = await StaffActivityLog.aggregate([
        { $match: { action: 'LOGIN', staff_member_id: { $ne: null } } },
        { $group: { _id: '$staff_member_id', last: { $max: '$timestamp' }, first: { $min: '$timestamp' } } },
      ]);
      const lastLogins = new Map(agg.map((r) => [String(r._id), r.last]));
      const oldest = agg.reduce((m, r) => (!m || r.first < m ? r.first : m), null);
      console.log(`audit trail: LOGIN of ${agg.length} accounts, oldest ${day(oldest)}`);
      const users = await AdminUser.find({}).select('email lastLoginAt').lean();
      const plan = backfillPlan(users, lastLogins);
      for (const p of plan) console.log(`  ${p.email}: ${day(p.from)} -> ${day(p.to)}`);
      console.log(`${plan.length} account(s) to update${dryRun ? ' (dry run, nothing saved)' : ''}`);
      if (dryRun || !plan.length) return;
      const res = await AdminUser.bulkWrite(
        plan.map((p) => ({ updateOne: { filter: { _id: p._id }, update: { $set: { lastLoginAt: p.to } } } }))
      );
      console.log(`Saved: ${res.modifiedCount}`);
      return;
    }

    const email = arg('--reactivate');
    if (email) {
      const byEmail = arg('--by');
      if (!byEmail) throw new Error('--by <super_user email> is required');
      const actor = await AdminUser.findOne({ email: byEmail }, { super_user: 1 }).lean();
      if (!actor?.super_user) throw new Error(`${byEmail} is not a super_user`);
      const user = await AdminUser.findOne({ email }, { active: 1, deactivatedAt: 1, deactivatedReason: 1 }).lean();
      if (!user) throw new Error(`no account with email ${email}`);
      if (user.active !== false) {
        console.log(`${email} is already active.`);
        return;
      }
      console.log(`${email}: disabled ${day(user.deactivatedAt)} (${user.deactivatedReason || 'no reason'}) -> active`);
      if (dryRun) return;
      await AdminUser.updateOne(
        { _id: user._id },
        { $set: { active: true, reactivatedAt: new Date(), deactivatedAt: null, deactivatedReason: null } }
      );
      const { logStaffActivity } = require('../controller/staffActivityLog');
      await logStaffActivity({
        staff_member_id: actor._id,
        actor_type: 'staff',
        action: 'REACTIVATE',
        target_model: 'AdminUser',
        target_id: String(user._id),
        details: { email, previous_reason: user.deactivatedReason || null, script: 'staff-inactivity' },
      });
      console.log('Saved.');
      return;
    }

    console.log('usage: --report | --backfill [--dry-run] | --reactivate <email> --by <super_user email> [--dry-run]');
    process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { reportRows, backfillPlan };
