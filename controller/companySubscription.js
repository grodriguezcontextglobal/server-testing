'use strict';

/**
 * Plan de la compañía, para el dashboard (2026-11-06; ver
 * reports/FRONTEND_subscription_plans_update_2026-11-06.md §3.3, §5, §6.1).
 *
 *   GET  /api/company/subscription           cualquier staff activo de la compañía
 *   POST /api/company/subscription/checkout  billing:update → { url } de Stripe Checkout
 *   POST /api/company/subscription/portal    billing:update → { url } del Billing Portal
 *
 * La compañía sale de `x-company-id` (la misma que comprobó
 * authorizeMongoPermission). Nada de lo que llega en el body decide el precio,
 * el cliente de Stripe ni la compañía: el plan solo cambia cuando lo dice el
 * webhook (controller/stripeWebhook.js).
 */

const { isValidObjectId } = require('mongoose');
const logger = require('../helpers/logger');
const { resolveCompanyContext } = require('../helpers/companyContext');
const { hasPermission } = require('../constants/rolePermissions');
const {
  CHECKOUT_INTERVALS,
  PRICE_ENV,
  PAID_STATUSES,
  trialDays,
  ADMIN_BASE_URL,
} = require('../constants/subscriptionPlans');
const {
  effectivePlan,
  effectiveLimits,
  countUsage,
  resolveSqlCompanyId,
} = require('../helpers/planLimits');

const realDeps = () => ({
  AdminUser: require('../models/AdminUser'),
  Company: require('../models/Company'),
  CompanySubscription: require('../models/CompanySubscription'),
  findCompanyMembership: require('../helpers/companyMembership').findCompanyMembership,
  stripe: require('../helpers/stripeClient').stripe,
  runStripeMutation: require('../helpers/stripeClient').runStripeMutation,
  logActivity: require('./staffActivityLog').logStaffActivity,
  countUsage,
  resolveSqlCompanyId,
});

const fail = (res, status, msg) => res.status(status).json({ ok: false, msg });

const companyFromRequest = (req) => {
  const id = resolveCompanyContext(req);
  return id && isValidObjectId(String(id)) ? String(id) : null;
};

/** Fila del plan + id SQL resuelto (sin crear la fila). */
async function loadContext(d, companyId) {
  const company = await d.Company.findById(companyId, {
    company_name: 1,
    stripe_customer_id: 1,
  }).lean();
  if (!company) return null;
  const record = await d.CompanySubscription.findOne({ company: companyId }).lean();
  const sqlCompanyId =
    record?.sql_company_id ?? (await d.resolveSqlCompanyId(company.company_name));
  return { company, record, sqlCompanyId };
}

function createGetCompanySubscription(deps) {
  return async function getCompanySubscription(req, res) {
    const d = { ...realDeps(), ...(deps || {}) };
    try {
      const companyId = companyFromRequest(req);
      if (!companyId) return fail(res, 400, 'Missing company context (x-company-id).');

      const adminUser = await d.AdminUser.findById(req.uid).select('super_user active email').lean();
      if (!adminUser || adminUser.active === false) return fail(res, 403, 'Forbidden');

      let canManageBilling = Boolean(adminUser.super_user);
      if (!adminUser.super_user) {
        const emp = await d.findCompanyMembership(companyId, { ...adminUser, id: req.uid });
        if (!emp) return fail(res, 403, 'Forbidden: not a member of this company');
        canManageBilling = Boolean(emp.super_user) || hasPermission(emp.roleType, 'billing', 'update');
      }

      const ctx = await loadContext(d, companyId);
      if (!ctx) return fail(res, 404, 'Company not found');
      const { record, sqlCompanyId } = ctx;

      let usage = { staff: null, items: null };
      if (sqlCompanyId) {
        const [staff, items] = await Promise.all([
          d.countUsage('staff', sqlCompanyId),
          d.countUsage('items', sqlCompanyId),
        ]);
        usage = { staff, items };
      }

      return res.status(200).json({
        ok: true,
        plan: record?.plan || 'free',
        effective_plan: effectivePlan(record),
        status: record?.status || 'active',
        interval: record?.interval ?? null,
        current_period_end: record?.current_period_end ?? null,
        cancel_at_period_end: Boolean(record?.cancel_at_period_end),
        trial_available: !record?.trial_used && trialDays() > 0,
        demo: Boolean(record?.demo),
        limits: effectiveLimits(record),
        usage,
        can_manage_billing: canManageBilling,
      });
    } catch (error) {
      logger.error('getCompanySubscription failed', { error: error.message });
      return fail(res, 500, 'The subscription could not be loaded.');
    }
  };
}

/** Cliente de Stripe de la compañía; se crea en el primer Checkout si no hay. */
async function ensureStripeCustomer(d, { companyId, company, record, adminUser }) {
  if (record?.stripe_customer_id) return record.stripe_customer_id;
  if (typeof company.stripe_customer_id === 'string' && company.stripe_customer_id.startsWith('cus_')) {
    return company.stripe_customer_id;
  }
  const customer = await d.runStripeMutation(() =>
    d.stripe.customers.create(
      {
        name: company.company_name,
        email: adminUser?.email || undefined,
        metadata: { company_id: companyId },
      },
      { idempotencyKey: `company-customer:${companyId}` }
    )
  );
  return customer.id;
}

function createSubscriptionCheckout(deps) {
  return async function createCheckout(req, res) {
    const d = { ...realDeps(), ...(deps || {}) };
    try {
      const { plan, interval } = req.body || {};
      if (plan !== 'pro') {
        return fail(res, 400, 'Only the Pro plan can be bought online. Contact sales for Enterprise.');
      }
      if (!CHECKOUT_INTERVALS.includes(interval)) {
        return fail(res, 400, 'interval must be "month" or "year".');
      }
      const price = process.env[PRICE_ENV[interval]];
      if (!price) {
        logger.error(`subscription checkout: ${PRICE_ENV[interval]} is not configured`);
        return fail(res, 503, 'Billing is not available right now. Please try again later.');
      }

      const companyId = companyFromRequest(req);
      if (!companyId) return fail(res, 400, 'Missing company context (x-company-id).');

      const ctx = await loadContext(d, companyId);
      if (!ctx) return fail(res, 404, 'Company not found');
      const { company, record, sqlCompanyId } = ctx;

      // Una compañía Pro al día no abre otro Checkout: crearía una segunda
      // suscripción. Cambiar de mensual a anual va por el Billing Portal.
      if (record?.plan === 'pro' && PAID_STATUSES.has(record.status)) {
        return fail(
          res,
          409,
          record.interval === interval
            ? 'This company is already on Pro with this billing interval.'
            : 'This company is already on Pro. Use "Manage billing" to switch between monthly and annual.'
        );
      }
      if (record?.plan === 'enterprise') {
        return fail(res, 409, 'This company is on Enterprise. Contact sales to change the plan.');
      }

      const adminUser = await d.AdminUser.findById(req.uid).select('email').lean();
      const customer = await ensureStripeCustomer(d, { companyId, company, record, adminUser });

      await d.CompanySubscription.updateOne(
        { company: companyId },
        {
          $set: { stripe_customer_id: customer, ...(sqlCompanyId ? { sql_company_id: sqlCompanyId } : {}) },
          $setOnInsert: { plan: 'free', status: 'active' },
        },
        { upsert: true }
      );

      const days = record?.trial_used ? 0 : trialDays();
      const base = ADMIN_BASE_URL();
      const session = await d.runStripeMutation(() =>
        d.stripe.checkout.sessions.create({
          mode: 'subscription',
          customer,
          line_items: [{ price, quantity: 1 }],
          client_reference_id: companyId,
          metadata: { company_id: companyId, interval },
          subscription_data: {
            metadata: { company_id: companyId, interval },
            ...(days > 0 ? { trial_period_days: days } : {}),
          },
          success_url: `${base}/profile/subscription?checkout=success`,
          cancel_url: `${base}/profile/subscription?checkout=canceled`,
        })
      );

      await d.logActivity({
        staff_member_id: req.uid,
        actor_type: 'staff',
        company_id: companyId,
        action: 'CREATE',
        target_model: 'Subscription',
        target_id: companyId,
        details: { kind: 'checkout_session', interval, trial_days: days, checkout_session_id: session.id },
        ip_address: req.ip,
      });

      return res.status(200).json({ ok: true, url: session.url });
    } catch (error) {
      logger.error('subscription checkout failed', { error: error.message, type: error.type });
      return fail(res, 502, 'Could not start the checkout. Please try again.');
    }
  };
}

function createSubscriptionPortal(deps) {
  return async function createPortal(req, res) {
    const d = { ...realDeps(), ...(deps || {}) };
    try {
      const companyId = companyFromRequest(req);
      if (!companyId) return fail(res, 400, 'Missing company context (x-company-id).');

      const record = await d.CompanySubscription.findOne({ company: companyId }).lean();
      if (!record?.stripe_customer_id) {
        return fail(res, 409, 'This company has no billing account yet.');
      }

      const session = await d.runStripeMutation(() =>
        d.stripe.billingPortal.sessions.create({
          customer: record.stripe_customer_id,
          return_url: `${ADMIN_BASE_URL()}/profile/subscription`,
        })
      );

      await d.logActivity({
        staff_member_id: req.uid,
        actor_type: 'staff',
        company_id: companyId,
        action: 'OPEN',
        target_model: 'Subscription',
        target_id: companyId,
        details: { kind: 'billing_portal_session' },
        ip_address: req.ip,
      });

      return res.status(200).json({ ok: true, url: session.url });
    } catch (error) {
      logger.error('subscription portal failed', { error: error.message, type: error.type });
      return fail(res, 502, 'Could not open the billing portal. Please try again.');
    }
  };
}

module.exports = {
  createGetCompanySubscription,
  createSubscriptionCheckout,
  createSubscriptionPortal,
  getCompanySubscription: createGetCompanySubscription(),
  createCheckout: createSubscriptionCheckout(),
  createPortal: createSubscriptionPortal(),
};
