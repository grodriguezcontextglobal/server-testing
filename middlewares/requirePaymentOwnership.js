'use strict';

/**
 * Stripe Fase 0.1 (PLAN_stripe_2026-10-06.md), 2026-10-19: el pago que se
 * captura, se libera o se reembolsa tiene que ser de la compañía de quien lo
 * mueve.
 *
 * Hay UNA sola cuenta de Stripe para todas las compañías, así que la sesión y el
 * permiso `transaction:update` solo dicen que alguien puede mover dinero, no de
 * quién: un staff de la compañía A podía reembolsar un pi_ de la compañía B.
 *
 * Dueño del pago, en este orden:
 *   1. Nuestros registros, que guardan la compañía (id de Mongo) en `company`:
 *      transactions, cashreports (paymentIntent_charge_transaction),
 *      stripetransactions y receivers. Medido en prod el 2026-10-06: 100% en
 *      transactions y cashreports, ~95% en las otras dos.
 *   2. Si no hay ningún registro: `metadata.company_id` del PaymentIntent, que
 *      create-payment-intent estampa desde 2026-09-28.
 *
 * Regla:
 *   - la compañía del contexto (x-company-id) es dueña → sigue;
 *   - es de OTRA compañía → 404 (no confirmar que ese pago existe);
 *   - sin dueño en ningún sitio (pagos viejos) → solo super_user de plataforma;
 *   - el super_user de plataforma pasa siempre (bypass de plataforma), y queda
 *     marcado en req.paymentOwnership para el audit trail.
 *
 * El id se lee con la MISMA función que usa el controlador (`getPaymentIntentId`):
 * si el middleware mirara otro campo (p. ej. :id) se podría comprobar un pago y
 * mover otro.
 */

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

function createRequirePaymentOwnership({ findOwners, retrievePaymentIntent, findAdmin, resolveCompany }) {
  return (getPaymentIntentId) => async (req, res, next) => {
    try {
      const paymentIntentId = getPaymentIntentId(req);
      if (typeof paymentIntentId !== 'string' || paymentIntentId.trim() === '') {
        return res.status(400).json({ ok: false, msg: 'Payment intent id is required' });
      }

      const admin = await findAdmin(req.uid);
      const platformSuperUser = Boolean(admin?.super_user);
      const companyId = resolveCompany(req);

      let owners = (await findOwners(paymentIntentId)).map(String).filter(Boolean);
      let source = 'records';
      if (owners.length === 0) {
        try {
          const pi = await retrievePaymentIntent(paymentIntentId);
          if (pi?.metadata?.company_id) owners = [String(pi.metadata.company_id)];
          source = 'stripe_metadata';
        } catch (error) {
          if (error?.code === 'resource_missing' || error?.statusCode === 404) {
            return res.status(404).json({ ok: false, msg: 'Payment not found' });
          }
          throw error;
        }
      }

      const ownedByCaller = owners.some((o) => sameId(o, companyId));
      req.paymentOwnership = { paymentIntentId, owners, source, companyId, platformSuperUser };

      if (ownedByCaller || platformSuperUser) return next();
      if (owners.length > 0) {
        return res.status(404).json({ ok: false, msg: 'Payment not found' });
      }
      return res.status(403).json({
        ok: false,
        msg: 'This payment has no recorded owner; only a platform administrator can move it.',
      });
    } catch (error) {
      return res.status(500).json({ ok: false, msg: 'Payment ownership check failed' });
    }
  };
}

function defaultDeps() {
  const Transaction = require('../models/Transaction');
  const CashReport = require('../models/CashReport');
  const StripeTransaction = require('../models/StripeTransaction');
  const Receivers = require('../models/Receivers');
  const AdminUser = require('../models/AdminUser');
  const { stripe } = require('../helpers/stripeClient');
  const { resolveCompanyContext } = require('../helpers/companyContext');

  const companiesOf = (Model, field, id) => Model.find({ [field]: id }, 'company').lean();
  return {
    findOwners: async (id) => {
      const lists = await Promise.all([
        companiesOf(Transaction, 'paymentIntent', id),
        companiesOf(CashReport, 'paymentIntent_charge_transaction', id),
        companiesOf(StripeTransaction, 'paymentIntent', id),
        companiesOf(Receivers, 'paymentIntent', id),
      ]);
      return [...new Set(lists.flat().map((r) => r?.company).filter(Boolean).map(String))];
    },
    retrievePaymentIntent: (id) => stripe.paymentIntents.retrieve(id),
    findAdmin: (uid) => AdminUser.findById(uid).select('super_user active').lean(),
    resolveCompany: resolveCompanyContext,
  };
}

let defaultFactory = null;
/** requirePaymentOwnership((req) => req.body.paymentIntent) */
const requirePaymentOwnership = (getPaymentIntentId) => {
  // Las dependencias se cargan al primer uso: así los tests del router no
  // necesitan Mongo ni Stripe para montar las rutas.
  let mw = null;
  return (req, res, next) => {
    if (!mw) {
      defaultFactory = defaultFactory || createRequirePaymentOwnership(defaultDeps());
      mw = defaultFactory(getPaymentIntentId);
    }
    return mw(req, res, next);
  };
};

module.exports = { createRequirePaymentOwnership, requirePaymentOwnership };
