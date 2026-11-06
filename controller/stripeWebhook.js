'use strict';

/**
 * POST /api/webhooks/stripe: la ÚNICA vía por la que cambia el plan de una
 * compañía de pago (2026-11-06; reports/FRONTEND_subscription_plans_update_2026-11-06.md §3.4).
 * La vuelta a success_url no prueba nada; lo que cuenta es el evento firmado.
 *
 * - Firma: stripe.webhooks.constructEvent sobre el cuerpo CRUDO con
 *   STRIPE_WEBHOOK_SECRET (routes/stripeWebhook.js monta express.raw).
 * - Idempotencia: StripeWebhookEvent guarda los ids procesados; un repetido se
 *   contesta 200 sin tocar nada.
 * - Orden: cada fila guarda el `created` del último evento aplicado; uno más
 *   viejo no pisa un estado más nuevo (Stripe no garantiza el orden).
 * - Respuesta: 200 DESPUÉS de aplicar, no antes. El trabajo son un par de
 *   escrituras en Mongo (milisegundos); contestar antes significaría que un
 *   fallo de Mongo perdería el evento, porque Stripe ya no lo reintentaría. Si
 *   algo falla se contesta 500 y Stripe reintenta (hasta 3 días).
 * - Solo se tocan suscripciones nuestras: las que crea el Checkout de Pro
 *   llevan metadata.company_id, o ya están enlazadas a una fila. Las de los
 *   planes viejos (Basic/Business de /api/subscription) se ignoran.
 */

const { isValidObjectId } = require('mongoose');
const logger = require('../helpers/logger');
const { resolveSqlCompanyId } = require('../helpers/planLimits');

const HANDLED_EVENTS = Object.freeze(new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
]));

const realDeps = () => ({
  stripe: require('../helpers/stripeClient').stripe,
  CompanySubscription: require('../models/CompanySubscription'),
  StripeWebhookEvent: require('../models/StripeWebhookEvent'),
  Company: require('../models/Company'),
  logActivity: require('./staffActivityLog').logStaffActivity,
  resolveSqlCompanyId,
});

const idOf = (value) => (value && typeof value === 'object' ? value.id : value) || null;
const toDate = (seconds) => (Number.isFinite(seconds) ? new Date(seconds * 1000) : null);

/** Campos que copiamos de un objeto Subscription de Stripe. */
function subscriptionFields(sub) {
  const item = sub?.items?.data?.[0];
  const interval = item?.price?.recurring?.interval ?? item?.plan?.interval ?? null;
  return {
    status: sub.status,
    interval: interval === 'month' || interval === 'year' ? interval : null,
    // current_period_end vive en la suscripción hasta la API 2025-03-31 y en
    // el item desde entonces: se leen las dos.
    current_period_end: toDate(sub.current_period_end ?? item?.current_period_end),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    stripe_subscription_id: sub.id,
    stripe_customer_id: idOf(sub.customer),
  };
}

const invoiceSubscriptionId = (invoice) =>
  idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription) ?? null;

function createStripeWebhookHandler(deps) {
  const d = { ...realDeps(), ...(deps || {}) };

  /** La fila de la compañía dueña de esta suscripción, o null si no es nuestra. */
  async function findRecord({ companyId, subscriptionId }) {
    if (subscriptionId) {
      const bySub = await d.CompanySubscription.findOne({ stripe_subscription_id: subscriptionId });
      if (bySub) return bySub;
    }
    if (companyId && isValidObjectId(String(companyId))) {
      const existing = await d.CompanySubscription.findOne({ company: companyId });
      if (existing) return existing;
      const company = await d.Company.findById(companyId, { company_name: 1 }).lean();
      if (!company) return null;
      return new d.CompanySubscription({
        company: companyId,
        sql_company_id: await d.resolveSqlCompanyId(company.company_name),
      });
    }
    return null;
  }

  async function apply(event, record, changes) {
    if (record.stripe_event_created && event.created < record.stripe_event_created) {
      return { outcome: 'stale', company: record.company };
    }
    const before = { plan: record.plan, status: record.status, interval: record.interval };
    Object.assign(record, changes, {
      updated_by_event: event.id,
      stripe_event_created: event.created,
    });
    if (!record.sql_company_id) {
      const company = await d.Company.findById(record.company, { company_name: 1 }).lean();
      record.sql_company_id = await d.resolveSqlCompanyId(company?.company_name);
    }
    await record.save();

    const after = { plan: record.plan, status: record.status, interval: record.interval };
    if (before.plan !== after.plan || before.status !== after.status || before.interval !== after.interval) {
      // AU-2: quién cambió qué plan. Aquí el autor es Stripe, por eso anonymous
      // con el id del evento como prueba.
      await d.logActivity({
        staff_member_id: null,
        actor_type: 'anonymous',
        company_id: String(record.company),
        action: 'PLAN_CHANGE',
        target_model: 'Subscription',
        target_id: String(record.company),
        details: { source: 'stripe', event_id: event.id, event_type: event.type, from: before, to: after },
      });
    }
    return { outcome: 'applied', company: record.company };
  }

  async function processEvent(event) {
    const object = event.data?.object || {};

    switch (event.type) {
      case 'checkout.session.completed': {
        if (object.mode !== 'subscription' || !object.subscription) return { outcome: 'ignored' };
        const companyId = object.client_reference_id || object.metadata?.company_id;
        const record = await findRecord({ companyId, subscriptionId: null });
        if (!record) return { outcome: 'unknown_company' };
        const sub = await d.stripe.subscriptions.retrieve(idOf(object.subscription));
        return apply(event, record, {
          plan: 'pro',
          ...subscriptionFields(sub),
          stripe_customer_id: idOf(object.customer) || idOf(sub.customer),
          trial_used: true,
        });
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const record = await findRecord({
          companyId: object.metadata?.company_id,
          subscriptionId: object.id,
        });
        if (!record) return { outcome: 'ignored' };
        return apply(event, record, {
          plan: 'pro',
          ...subscriptionFields(object),
          ...(object.trial_start ? { trial_used: true } : {}),
        });
      }

      case 'customer.subscription.deleted': {
        const record = await findRecord({
          companyId: object.metadata?.company_id,
          subscriptionId: object.id,
        });
        if (!record) return { outcome: 'ignored' };
        // Una suscripción vieja que se borra no baja a Free a la compañía si
        // ya tiene otra enlazada.
        if (record.stripe_subscription_id && record.stripe_subscription_id !== object.id) {
          return { outcome: 'ignored', company: record.company };
        }
        if (record.plan === 'enterprise') return { outcome: 'ignored', company: record.company };
        return apply(event, record, {
          plan: 'free',
          status: 'canceled',
          interval: null,
          current_period_end: null,
          cancel_at_period_end: false,
          stripe_subscription_id: null,
        });
      }

      case 'invoice.payment_failed':
      case 'invoice.paid': {
        const subscriptionId = invoiceSubscriptionId(object);
        if (!subscriptionId) return { outcome: 'ignored' };
        const record = await findRecord({ companyId: null, subscriptionId });
        if (!record || record.plan !== 'pro') return { outcome: 'ignored' };
        if (event.type === 'invoice.payment_failed') {
          return apply(event, record, { status: 'past_due' });
        }
        // Una factura pagada solo saca de un estado de impago: la factura de
        // 0 $ del inicio de la prueba no debe pasar trialing a active.
        if (!['past_due', 'unpaid', 'incomplete'].includes(record.status)) {
          return { outcome: 'ignored', company: record.company };
        }
        return apply(event, record, { status: 'active' });
      }

      default:
        return { outcome: 'ignored' };
    }
  }

  return async function stripeWebhook(req, res) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('stripe webhook: STRIPE_WEBHOOK_SECRET is not configured');
      return res.status(503).json({ ok: false });
    }

    let event;
    try {
      event = d.stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
    } catch (error) {
      logger.warn('stripe webhook: invalid signature', { error: error.message, ip: req.ip });
      return res.status(400).json({ ok: false, msg: 'Invalid signature' });
    }

    if (!HANDLED_EVENTS.has(event.type)) {
      return res.status(200).json({ received: true, ignored: true });
    }

    try {
      if (await d.StripeWebhookEvent.exists({ _id: event.id })) {
        return res.status(200).json({ received: true, duplicate: true });
      }

      const { outcome, company = null } = await processEvent(event);

      try {
        await d.StripeWebhookEvent.create({ _id: event.id, type: event.type, company, outcome });
      } catch (error) {
        // 11000: otro proceso lo registró a la vez. Lo aplicado es idempotente.
        if (error?.code !== 11000) throw error;
      }

      if (outcome !== 'applied') {
        logger.info(`stripe webhook: ${event.type} ${outcome}`, { event_id: event.id });
      }
      return res.status(200).json({ received: true, outcome });
    } catch (error) {
      logger.error('stripe webhook: processing failed', {
        event_id: event.id,
        type: event.type,
        error: error.message,
      });
      return res.status(500).json({ ok: false });
    }
  };
}

module.exports = {
  createStripeWebhookHandler,
  subscriptionFields,
  invoiceSubscriptionId,
  HANDLED_EVENTS,
};
