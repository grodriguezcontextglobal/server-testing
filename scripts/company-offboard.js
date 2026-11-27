'use strict';

/**
 * Baja y alta de un CLIENTE (APP-2026-016 · AU-11).
 *
 *   node scripts/company-offboard.js --list
 *       Todas las compañias: id de Mongo, id SQL si cruza, cuantas cuentas de
 *       staff tiene y, si esta dada de baja, desde cuando y por que. Solo lee.
 *
 *   node scripts/company-offboard.js --offboard "<nombre o id>" \
 *        --reason "no renovo el contrato" --by <email super_user> [--at AAAA-MM-DD] [--dry-run]
 *
 *   node scripts/company-offboard.js --reinstate "<nombre o id>" \
 *        --by <email super_user> [--dry-run]
 *
 * ESTO NO BORRA NADA. Escribe una fecha en `Company.offboardedAt` y una fila en
 * el audit trail. Los eventos, transacciones, inventario y consumidores del
 * cliente se quedan donde estan. Lo unico que cambia es que
 * scheduler/platformAuditRetention.js pasa a contar los 120 dias de retencion
 * del log del console desde esa fecha en vez de desde el dia en que observe
 * que la compañia ya no esta — y ese job sigue en `warn`, asi que hoy tampoco
 * borra: calcula y lo registra.
 *
 * `--at` admite una fecha pasada, que es el caso normal: la baja se registra
 * despues de que ocurriera. No admite futuro: una fecha por venir haria que el
 * contador arrancara en negativo y la compañia figurara de baja antes de
 * estarlo.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
const normalize = (s) => String(s || '').trim().toLowerCase();

// ─── Logica pura (sin DB), exportada para el test ───────────────────────────

/**
 * Encuentra UNA compañia por id exacto o por nombre, sin distinguir mayusculas.
 * Dos nombres iguales no se resuelven solos: se devuelven para que quien llama
 * use el id. Hay nombres repetidos en produccion ("testing inc" y "Testing
 * Inc."), asi que esto no es teorico.
 *
 * @returns {{ company?: object, error?: string, candidates?: object[] }}
 */
const resolveCompany = (companies, needle) => {
  const raw = String(needle || '').trim();
  if (!raw) return { error: 'falta el nombre o el id de la compañia' };

  const byId = companies.find((c) => String(c._id) === raw);
  if (byId) return { company: byId };

  const matches = companies.filter((c) => normalize(c.company_name) === normalize(raw));
  if (matches.length === 1) return { company: matches.at(0) };
  if (matches.length > 1) {
    return {
      error: `"${raw}" nombra a ${matches.length} compañias; usa el id`,
      candidates: matches,
    };
  }
  return { error: `no hay ninguna compañia que sea "${raw}"` };
};

/**
 * Que hacer con una compañia, sin tocar nada. `now` entra para poder probarlo.
 *
 * @returns {{ ok: boolean, reason?: string, set?: object }}
 */
const offboardPlan = ({ company, at, reason, actorId, now = new Date() }) => {
  if (company.offboardedAt) {
    return { ok: false, reason: `ya esta de baja desde el ${day(company.offboardedAt)}` };
  }
  if (!String(reason || '').trim()) {
    return { ok: false, reason: '--reason es obligatorio: la fecha sin el motivo no sirve de evidencia' };
  }
  const when = at ? new Date(at) : now;
  if (Number.isNaN(when.getTime())) return { ok: false, reason: `--at no es una fecha: "${at}"` };
  if (when.getTime() > now.getTime() + DAY_MS) {
    return { ok: false, reason: `--at esta en el futuro (${day(when)})` };
  }
  return {
    ok: true,
    set: { offboardedAt: when, offboardedReason: String(reason).trim(), offboardedBy: actorId || null },
  };
};

const reinstatePlan = ({ company }) => {
  if (!company.offboardedAt) return { ok: false, reason: 'no esta de baja' };
  return { ok: true, set: { offboardedAt: null, offboardedReason: '', offboardedBy: null } };
};

// ─── Ejecucion ──────────────────────────────────────────────────────────────

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();

  const Company = require('../models/Company');
  const AdminUser = require('../models/AdminUser');
  const dryRun = process.argv.includes('--dry-run');

  try {
    const companies = await Company.find({})
      .select('_id company_name employees.active offboardedAt offboardedReason offboardedBy')
      .lean();

    if (process.argv.includes('--list')) {
      // El id SQL sale de la suscripcion si la hay y, si no, del cruce por
      // nombre — que es el mismo orden que usa el console (helpers/planLimits.js
      // y controller/platform.js#gatherCompanies). Hoy hace falta el cruce
      // siempre: `companysubscriptions` esta VACIA en produccion, asi que sin
      // el la columna saldria nula para las 22.
      const subs = await require('../models/CompanySubscription')
        .find({}).select('company sql_company_id').lean();
      const subBy = new Map(subs.map((s) => [String(s.company), s]));
      const [sqlRows] = await require('../mysql/database/config')()
        .query('SELECT company_id, company_name FROM company_info');
      const sqlIdByName = new Map(sqlRows.map((r) => [String(r.company_name ?? ''), Number(r.company_id)]));
      const rows = companies
        .map((c) => {
          const sub = subBy.get(String(c._id));
          return {
            company: c.company_name,
            mongo_id: String(c._id),
            sql_id: sub?.sql_company_id ?? sqlIdByName.get(String(c.company_name ?? '')) ?? null,
            staff: (c.employees || []).filter((e) => e.active !== false).length,
            offboarded_at: day(c.offboardedAt),
            reason: c.offboardedReason || '',
          };
        })
        .sort((a, b) => a.company.localeCompare(b.company));
      console.table(rows);
      const down = rows.filter((r) => r.offboarded_at !== '-').length;
      console.log(`${rows.length} compañias, ${down} de baja, ${rows.length - down} activas`);
      return;
    }

    const mode = ['--offboard', '--reinstate'].find((m) => arg(m));
    if (!mode) throw new Error('usa --list, --offboard <compañia> o --reinstate <compañia>');

    const byEmail = arg('--by');
    if (!byEmail) throw new Error('--by <email de un super_user> es obligatorio');
    const actor = await AdminUser.findOne({ email: byEmail, super_user: true, active: { $ne: false } })
      .select('_id email').lean();
    if (!actor) throw new Error(`--by: ${byEmail} no es una cuenta super_user activa`);

    const found = resolveCompany(companies, arg(mode));
    if (found.error) {
      for (const c of found.candidates || []) console.log(`  ${String(c._id)}  ${c.company_name}`);
      throw new Error(found.error);
    }
    const company = found.company;

    const plan =
      mode === '--offboard'
        ? offboardPlan({ company, at: arg('--at'), reason: arg('--reason'), actorId: actor._id })
        : reinstatePlan({ company });

    if (!plan.ok) {
      console.log(`${company.company_name}: ${plan.reason}`);
      return;
    }

    const action = mode === '--offboard' ? 'OFFBOARD' : 'REINSTATE';
    console.log(
      `${action} ${company.company_name} (${String(company._id)})` +
        (mode === '--offboard' ? ` el ${day(plan.set.offboardedAt)} — ${plan.set.offboardedReason}` : '')
    );
    if (dryRun) {
      console.log('(dry run, no se ha guardado nada)');
      return;
    }

    const res = await Company.updateOne({ _id: company._id }, { $set: plan.set });
    if (!res.modifiedCount) {
      console.log('nada que cambiar (¿otra ejecucion se adelanto?)');
      return;
    }

    const { logStaffActivity } = require('../controller/staffActivityLog');
    await logStaffActivity({
      staff_member_id: actor._id,
      actor_type: 'staff',
      action,
      target_model: 'Company',
      target_id: String(company._id),
      details: {
        company_name: company.company_name,
        from: day(company.offboardedAt),
        to: day(plan.set.offboardedAt),
        reason: plan.set.offboardedReason || '',
        script: 'company-offboard',
      },
    });
    console.log('guardado, con su fila en el audit trail');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { resolveCompany, offboardPlan, reinstatePlan };
