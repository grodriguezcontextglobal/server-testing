'use strict';

/**
 * Stripe A8b (FedRAMP AC-3, 2026-10-27): la suscripción, el cliente, la cuenta
 * conectada o el registro de facturación sobre el que actúa una petición tiene
 * que ser de la compañía de quien la hace.
 *
 * Desde A8 estas rutas exigen sesión, pero la sesión solo dice quién llama. Con
 * UNA sola cuenta de Stripe para todas las compañías, un staff de la compañía A
 * podía cancelar, consultar o cambiar el método de pago de una suscripción de la
 * compañía B con solo conocer su sub_. Es lo mismo que requirePaymentOwnership
 * hace con los pagos.
 *
 * Clientes de Stripe de una compañía (cus_):
 *   - Company.stripe_customer_id, si es un cus_;
 *   - el stripeID de los StripeCompany con el mismo nombre (company_name =
 *     companyName, sin distinguir mayúsculas). Es lo que usa el dashboard
 *     (companyAccountStripe.stripeID), y StripeCompany no guarda el id de la
 *     compañía, solo su nombre.
 *
 * Tipos de recurso:
 *   customer          el cus_ tiene que ser de la compañía
 *   subscription      el customer de la suscripción
 *   setupIntent       el customer del setup intent (o de su método de pago)
 *   paymentIntent     su customer, o metadata.company_id (create-payment-intent
 *                     la estampa desde 2026-09-28)
 *   connectedAccount  el acct_ de Company.stripe_connected_account
 *   stripeCompany     el registro StripeCompany (por stripeID o por nombre)
 *   company           el id de compañía que trae la petición (body.company al
 *                     guardar o listar transacciones)
 *   transaction       la compañía del Transaction que se borra
 *   stripeTransaction la compañía del StripeTransaction que se borra
 *   subscriptionRecord el documento Subscription de Mongo (/api/subscription):
 *                     su `company` es el NOMBRE de la compañía
 *   companyName       el nombre de compañía que trae la petición
 *                     (/api/subscription filtra y crea por nombre)
 *
 * Pertenencia (2026-11-03): la compañía del contexto sale de `x-company-id`, que
 * pone el cliente. Antes solo se comprobaba que el recurso fuera de ESA
 * compañía, no que quien llama perteneciera a ella: un staff de A que mandara
 * el id de B pasaba con los recursos de B. Ahora tiene que ser empleado activo
 * de la compañía del contexto (Company.employees por userId o por email, igual
 * que authorizeMongoPermission). Si no, `not_a_member`.
 *
 * Listados (`{ injectBodyCompany: true }`): sin body.company, enforce lo pone
 * con la compañía del contexto; así el filtro que manda el cliente no puede
 * devolver transacciones de otras. En warn solo se registra (unscoped_list).
 * `injectCompany(req, companyId)` hace lo mismo donde el filtro no es el body
 * (GET /api/transaction/transaction lee la query).
 *
 * `onlyWithSession: true`: en las rutas de dos carriles, sin sesión de staff
 * (req.uid) no se comprueba nada; ese carril es la app de consumidor.
 *
 * Búsqueda de pagos (`paymentIntentSearch`): no hay id que comprobar; en
 * enforce deja en req.stripeSearchCompany la compañía por la que el
 * controlador filtra (metadata.company_id). El super_user de plataforma busca
 * en todas.
 *
 * Regla: de la compañía del contexto (x-company-id) → sigue; super_user de
 * plataforma → sigue; si no → 404, sin confirmar que el recurso existe.
 *
 * STRIPE_OWNERSHIP_MODE:
 *   warn     (por defecto) deja pasar y registra lo que enforce rechazaría. Los
 *            vínculos compañía ↔ Stripe no se han medido en producción: el log
 *            (scripts/summarize-warn-logs.js) dice si se puede pasar a enforce.
 *   enforce  responde 404 (o 400 sin compañía en el contexto).
 *   off      no comprueba.
 */

const mode = () => String(process.env.STRIPE_OWNERSHIP_MODE || 'warn').toLowerCase();

const isCus = (v) => typeof v === 'string' && v.startsWith('cus_');
const sameId = (a, b) => a != null && b != null && String(a?._id ?? a) === String(b);
const sameText = (a, b) =>
  a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function createRequireStripeOwnership(deps) {
  const {
    findAdmin, resolveCompany, findCompany, findStripeCompaniesByName, findStripeCompany,
    findTransaction, findStripeTransaction, findSubscriptionRecord, stripeApi, connectedAccountOf, logger,
  } = deps;

  // Misma regla que authorizeMongoPermission: el employee se identifica por
  // userId (backfilled) o por email, y tiene que estar activo.
  const isMember = (company, admin, uid) =>
    (company.employees || []).some(
      (e) =>
        e.active !== false &&
        ((e.userId != null && String(e.userId) === String(uid)) ||
          (admin?.email != null && e.user === admin.email)),
    );

  async function customersOf(company) {
    const owned = new Set();
    if (isCus(company.stripe_customer_id)) owned.add(company.stripe_customer_id);
    if (company.company_name) {
      for (const sc of await findStripeCompaniesByName(company.company_name)) {
        if (isCus(sc.stripeID)) owned.add(sc.stripeID);
      }
    }
    return owned;
  }

  const customerOfSubscription = async (id) => (await stripeApi.retrieveSubscription(id))?.customer;
  async function customerOfSetupIntent(id) {
    const si = await stripeApi.retrieveSetupIntent(id);
    if (si?.customer) return si.customer;
    if (!si?.payment_method) return null;
    return (await stripeApi.retrievePaymentMethod(si.payment_method))?.customer ?? null;
  }
  const idOf = (v) => (v && typeof v === 'object' ? v.id : v);

  /** null si es de la compañía; si no, el motivo. */
  async function problem(kind, id, company) {
    switch (kind) {
      case 'customer':
        return (await customersOf(company)).has(id) ? null : 'customer_not_owned';
      case 'subscription':
        return (await customersOf(company)).has(idOf(await customerOfSubscription(id))) ? null : 'subscription_not_owned';
      case 'setupIntent':
        return (await customersOf(company)).has(idOf(await customerOfSetupIntent(id))) ? null : 'setup_intent_not_owned';
      case 'paymentIntent': {
        const pi = await stripeApi.retrievePaymentIntent(id);
        const owned =
          String(pi?.metadata?.company_id ?? '') === String(company._id) ||
          (await customersOf(company)).has(idOf(pi?.customer));
        return owned ? null : 'payment_intent_not_owned';
      }
      case 'connectedAccount':
        return connectedAccountOf(company) === id ? null : 'connected_account_not_owned';
      case 'stripeCompany': {
        const sc = await findStripeCompany(id);
        if (!sc) return 'stripe_company_not_found';
        const owned = (await customersOf(company)).has(sc.stripeID) || sameText(sc.companyName, company.company_name);
        return owned ? null : 'stripe_company_not_owned';
      }
      case 'company':
        return sameId(id, company._id) ? null : 'company_not_owned';
      case 'transaction': {
        const doc = await findTransaction(id);
        if (!doc) return 'transaction_not_found';
        return sameId(doc.company, company._id) ? null : 'transaction_not_owned';
      }
      case 'stripeTransaction': {
        const doc = await findStripeTransaction(id);
        if (!doc) return 'stripe_transaction_not_found';
        return sameId(doc.company, company._id) ? null : 'stripe_transaction_not_owned';
      }
      case 'subscriptionRecord': {
        const doc = await findSubscriptionRecord(id);
        if (!doc) return 'subscription_record_not_found';
        return sameText(doc.company, company.company_name) ? null : 'subscription_record_not_owned';
      }
      case 'companyName':
        return sameText(id, company.company_name) ? null : 'company_name_not_owned';
      default:
        throw new Error(`Unknown Stripe resource kind: ${kind}`);
    }
  }

  const setBodyCompany = (req, companyId) => {
    req.body = { ...(req.body || {}), company: companyId };
  };

  return (kind, getId, { injectBodyCompany = false, injectCompany = null, onlyWithSession = false } = {}) => async (req, res, next) => {
    const m = mode();
    if (m === 'off') return next();
    // Rutas de dos carriles (/api/transaction): sin sesión de staff es la app
    // de consumidor, que tiene sus propias reglas (helpers/publicTransactionLane.js).
    if (onlyWithSession && !req.uid) return next();
    const inject = injectCompany || (injectBodyCompany ? setBodyCompany : null);
    const enforce = m === 'enforce';
    const id = getId(req);
    const companyId = resolveCompany(req);
    const detail = { route: req.originalUrl?.split('?')[0] || req.url, method: req.method, kind, companyId };

    const refuse = (status, msg, reason) => {
      if (!enforce) {
        logger.warn(`stripe ownership: ${reason} (STRIPE_OWNERSHIP_MODE=warn)`, { ...detail, reason });
        return next();
      }
      logger.warn(`stripe ownership: ${reason}`, { ...detail, reason });
      return res.status(status).json({ ok: false, msg });
    };

    try {
      const admin = await findAdmin(req.uid);
      if (admin?.super_user) return next();
      const company = companyId ? await findCompany(companyId) : null;
      if (!company) return refuse(400, 'Select a company to continue.', 'no_company');
      if (!isMember(company, admin, req.uid)) return refuse(403, 'Forbidden.', 'not_a_member');

      if (kind === 'paymentIntentSearch') {
        if (!enforce) {
          logger.warn('stripe ownership: unscoped_search (STRIPE_OWNERSHIP_MODE=warn)', { ...detail, reason: 'unscoped_search' });
        } else {
          req.stripeSearchCompany = String(company._id);
        }
        return next();
      }
      const missing = id == null || String(id).trim() === '';
      if (missing && inject) {
        if (!enforce) {
          logger.warn('stripe ownership: unscoped_list (STRIPE_OWNERSHIP_MODE=warn)', { ...detail, reason: 'unscoped_list' });
          return next();
        }
        inject(req, String(company._id));
        return next();
      }
      if (missing) return refuse(400, 'A Stripe resource id is required.', 'missing_id');

      const why = await problem(kind, id, company);
      if (!why) return next();
      return refuse(404, 'Not found.', why);
    } catch (error) {
      if (error?.code === 'resource_missing' || error?.statusCode === 404) {
        return refuse(404, 'Not found.', 'stripe_resource_missing');
      }
      logger.error('stripe ownership check failed', { ...detail, err: error?.message });
      if (!enforce) return next();
      return res.status(500).json({ ok: false, msg: 'Ownership check failed.' });
    }
  };
}

function defaultDeps() {
  const AdminUser = require('../models/AdminUser');
  const Company = require('../models/Company');
  const StripeCompany = require('../models/StripeCompany');
  const { stripe } = require('../helpers/stripeClient');
  const { resolveCompanyContext } = require('../helpers/companyContext');
  const { resolveConnectedAccountId } = require('../helpers/stripeConnectedAccount');
  const { isValidObjectId } = require('mongoose');
  const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return {
    findAdmin: (uid) => (uid ? AdminUser.findById(uid).select('super_user email').lean() : null),
    resolveCompany: resolveCompanyContext,
    findCompany: (id) =>
      isValidObjectId(id)
        ? Company.findById(id)
            .select('company_name stripe_customer_id stripe_connected_account employees.userId employees.user employees.active')
            .lean()
        : null,
    findSubscriptionRecord: (id) =>
      isValidObjectId(id) ? require('../models/Subscription').findById(id).select('company').lean() : null,
    findStripeCompaniesByName: (name) =>
      StripeCompany.find({ companyName: new RegExp(`^\\s*${escape(String(name).trim())}\\s*$`, 'i') })
        .select('stripeID companyName')
        .lean(),
    findStripeCompany: (id) => (isValidObjectId(id) ? StripeCompany.findById(id).select('stripeID companyName').lean() : null),
    findTransaction: (id) => (isValidObjectId(id) ? require('../models/Transaction').findById(id).select('company').lean() : null),
    findStripeTransaction: (id) =>
      isValidObjectId(id) ? require('../models/StripeTransaction').findById(id).select('company').lean() : null,
    stripeApi: {
      retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
      retrieveSetupIntent: (id) => stripe.setupIntents.retrieve(id),
      retrievePaymentMethod: (id) => stripe.paymentMethods.retrieve(id),
      retrievePaymentIntent: (id) => stripe.paymentIntents.retrieve(id),
    },
    connectedAccountOf: (company) => resolveConnectedAccountId(company),
    logger: require('../helpers/logger'),
  };
}

let defaultFactory = null;
/** requireStripeOwnership('subscription', (req) => req.params.id[, { injectBodyCompany }]) */
const requireStripeOwnership = (kind, getId = () => undefined, opts) => {
  // Dependencias al primer uso: los tests del router no necesitan Mongo ni Stripe.
  let mw = null;
  return function requireStripeOwnership(req, res, next) {
    if (!mw) {
      defaultFactory = defaultFactory || createRequireStripeOwnership(defaultDeps());
      mw = defaultFactory(kind, getId, opts);
    }
    return mw(req, res, next);
  };
};

module.exports = { createRequireStripeOwnership, requireStripeOwnership };
