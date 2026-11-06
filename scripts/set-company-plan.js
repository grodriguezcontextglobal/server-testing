'use strict';

/**
 * Cambia el plan de una compañía FUERA de Stripe (2026-11-06; pedido del
 * dashboard §2.3): Enterprise, topes a medida o devolver a Free. Solo un
 * super_user, y queda registrado como PLAN_CHANGE con su id (AU-2, AC-2).
 *
 * El plan de una compañía que paga Pro lo lleva Stripe: si tiene una
 * suscripción enlazada, este script se niega a cambiarle el plan (cancélala en
 * Stripe primero); los overrides sí se pueden poner.
 *
 *   node scripts/set-company-plan.js --company <mongoId> --plan enterprise \
 *     --staff 50 --items 20000 --by admin@devitrak.net
 *   node scripts/set-company-plan.js --company <mongoId> --staff none --by ...   (quita el override)
 *   node scripts/set-company-plan.js --company <mongoId> --demo on --by ...      (demo: Free sin topes)
 *   node scripts/set-company-plan.js --company <mongoId> --demo off --by ...     (vuelve a los topes de su plan)
 *   añadir --dry-run para ver el cambio sin guardarlo.
 */

const { PLANS } = require('../constants/subscriptionPlans');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** "none" quita el override; un entero >= 0 lo pone; ausente no lo toca. */
function parseLimit(raw, name) {
  if (raw === undefined) return undefined;
  if (raw === 'none') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number or "none"`);
  return n;
}

/** "on" / "off" para --demo; ausente no lo toca. */
function parseDemo(raw) {
  if (raw === undefined) return undefined;
  if (raw === 'on') return true;
  if (raw === 'off') return false;
  throw new Error('--demo must be "on" or "off"');
}

/**
 * Calcula el cambio sin tocar la base (testeable).
 * @returns {{ set: object, from: object, to: object }}
 */
function planChange(record, { plan, staff, items, demo }) {
  if (plan !== undefined && !PLANS.includes(plan)) {
    throw new Error(`plan must be one of: ${PLANS.join(', ')}`);
  }
  if (plan !== undefined && record?.stripe_subscription_id && plan !== record.plan) {
    throw new Error(
      `this company has a Stripe subscription (${record.stripe_subscription_id}); cancel it in Stripe first`
    );
  }
  const overrides = { ...(record?.limit_overrides || {}) };
  if (staff !== undefined) overrides.staff = staff;
  if (items !== undefined) overrides.items = items;
  for (const key of Object.keys(overrides)) {
    if (overrides[key] === null || overrides[key] === undefined) delete overrides[key];
  }

  const set = { limit_overrides: Object.keys(overrides).length ? overrides : null };
  if (demo !== undefined) set.demo = demo;
  if (plan !== undefined && plan !== record?.plan) {
    set.plan = plan;
    set.status = 'active';
    if (plan !== 'pro') {
      set.interval = null;
      set.current_period_end = null;
      set.cancel_at_period_end = false;
    }
  }
  const from = {
    plan: record?.plan || 'free',
    demo: Boolean(record?.demo),
    limit_overrides: record?.limit_overrides || null,
  };
  const to = {
    plan: set.plan || from.plan,
    demo: set.demo ?? from.demo,
    limit_overrides: set.limit_overrides,
  };
  return { set, from, to };
}

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();
  const AdminUser = require('../models/AdminUser');
  const Company = require('../models/Company');
  const CompanySubscription = require('../models/CompanySubscription');
  const { resolveSqlCompanyId } = require('../helpers/planLimits');
  const { logStaffActivity } = require('../controller/staffActivityLog');

  try {
    const companyId = arg('--company');
    const byEmail = arg('--by');
    if (!companyId || !mongoose.isValidObjectId(companyId)) throw new Error('--company <mongoId> is required');
    if (!byEmail) throw new Error('--by <super_user email> is required');

    const actor = await AdminUser.findOne({ email: byEmail }, { super_user: 1, email: 1 }).lean();
    if (!actor?.super_user) throw new Error(`${byEmail} is not a super_user`);

    const company = await Company.findById(companyId, { company_name: 1 }).lean();
    if (!company) throw new Error(`company ${companyId} not found`);

    const record = await CompanySubscription.findOne({ company: companyId }).lean();
    const { set, from, to } = planChange(record, {
      plan: arg('--plan'),
      staff: parseLimit(arg('--staff'), '--staff'),
      items: parseLimit(arg('--items'), '--items'),
      demo: parseDemo(arg('--demo')),
    });

    console.log(`${company.company_name}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
    if (process.argv.includes('--dry-run')) return;

    const sqlCompanyId = record?.sql_company_id ?? (await resolveSqlCompanyId(company.company_name));
    await CompanySubscription.updateOne(
      { company: companyId },
      { $set: { ...set, sql_company_id: sqlCompanyId, updated_by_user: actor._id } },
      { upsert: true }
    );
    await logStaffActivity({
      staff_member_id: actor._id,
      actor_type: 'staff',
      company_id: companyId,
      action: 'PLAN_CHANGE',
      target_model: 'Subscription',
      target_id: companyId,
      details: { source: 'super_user', script: 'set-company-plan', from, to },
    });
    console.log('Saved.');
  } finally {
    try {
      await require('../mysql/database/config')().end();
    } catch {
      /* sin pool abierto */
    }
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { planChange, parseLimit, parseDemo };
