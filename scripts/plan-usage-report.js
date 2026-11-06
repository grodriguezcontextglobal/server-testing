'use strict';

/**
 * Uso de cada compañía frente a su plan (2026-11-06). Responde a la pregunta
 * del §4.4 del pedido del dashboard: ¿cuántas compañías superan YA los topes de
 * Free (3 staff / 1,000 items)? Hace falta antes de pasar PLAN_LIMITS_MODE a
 * enforce, para decidir qué se hace con ellas.
 *
 * Solo lee. Mismo conteo que helpers/planLimits.js:
 *   staff = company_staff activo; items = item_inv.
 *
 *   node scripts/plan-usage-report.js            solo las que superan su tope
 *   node scripts/plan-usage-report.js --all      todas
 *   node scripts/plan-usage-report.js --json
 */

const { effectiveLimits, effectivePlan } = require('../helpers/planLimits');
const { PLAN_LIMITS } = require('../constants/subscriptionPlans');

/**
 * @param {Array<{company_id:number, company_name:string}>} companies
 * @param {Map<number, number>} staffById
 * @param {Map<number, number>} itemsById
 * @param {Map<number, object>} subsBySqlId  CompanySubscription por sql_company_id
 */
function classifyUsage(companies, staffById, itemsById, subsBySqlId) {
  return companies.map((c) => {
    const record = subsBySqlId.get(Number(c.company_id)) || null;
    const limits = effectiveLimits(record);
    const staff = staffById.get(Number(c.company_id)) || 0;
    const items = itemsById.get(Number(c.company_id)) || 0;
    const over = (value, limit) => limit !== null && value > limit;
    return {
      company_id: Number(c.company_id),
      company_name: c.company_name,
      plan: effectivePlan(record),
      demo: Boolean(record?.demo),
      staff,
      items,
      limits,
      over_staff: over(staff, limits.staff),
      over_items: over(items, limits.items),
      over_free_staff: staff > PLAN_LIMITS.free.staff,
      over_free_items: items > PLAN_LIMITS.free.items,
    };
  });
}

// Las demo no cuentan como "superan Free": no tienen topes por decisión.
function summarize(rows) {
  const paying = rows.filter((r) => !r.demo);
  return {
    companies: rows.length,
    demo: rows.length - paying.length,
    over_own_plan: rows.filter((r) => r.over_staff || r.over_items).length,
    over_free_staff: paying.filter((r) => r.over_free_staff).length,
    over_free_items: paying.filter((r) => r.over_free_items).length,
    over_free_any: paying.filter((r) => r.over_free_staff || r.over_free_items).length,
  };
}

const toMap = (rows) => new Map(rows.map((r) => [Number(r.company_id), Number(r.n)]));

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  const getConnection = require('../mysql/database/config');
  await dbConnection();
  const CompanySubscription = require('../models/CompanySubscription');
  const pool = getConnection();

  try {
    const [companies] = await pool.query('SELECT company_id, company_name FROM company_info');
    const [staffRows] = await pool.query(
      'SELECT company_id, COUNT(*) AS n FROM company_staff WHERE is_active = 1 GROUP BY company_id'
    );
    const [itemRows] = await pool.query('SELECT company_id, COUNT(*) AS n FROM item_inv GROUP BY company_id');
    const subs = await CompanySubscription.find({ sql_company_id: { $ne: null } }).lean();

    const rows = classifyUsage(
      companies,
      toMap(staffRows),
      toMap(itemRows),
      new Map(subs.map((s) => [Number(s.sql_company_id), s]))
    );
    const summary = summarize(rows);
    const shown = process.argv.includes('--all')
      ? rows
      : rows.filter((r) => r.over_staff || r.over_items || r.over_free_staff || r.over_free_items);
    shown.sort((a, b) => b.items - a.items || b.staff - a.staff);

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ summary, companies: shown }, null, 2));
    } else {
      console.log(
        `Compañías: ${summary.companies}. Superan Free: ${summary.over_free_any} ` +
          `(staff > ${PLAN_LIMITS.free.staff}: ${summary.over_free_staff}, ` +
          `items > ${PLAN_LIMITS.free.items}: ${summary.over_free_items}). ` +
          `Superan su propio plan: ${summary.over_own_plan}. Demo (sin topes, fuera del conteo): ${summary.demo}.`
      );
      for (const r of shown) {
        const lim = (v) => (v === null ? '∞' : v);
        console.log(
          `  [${r.company_id}] ${r.company_name}  plan=${r.plan}${r.demo ? ' (demo)' : ''}  ` +
            `staff ${r.staff}/${lim(r.limits.staff)}${r.over_staff ? ' !' : ''}  ` +
            `items ${r.items}/${lim(r.limits.items)}${r.over_items ? ' !' : ''}`
        );
      }
    }
  } finally {
    await pool.end().catch(() => {});
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { classifyUsage, summarize };
