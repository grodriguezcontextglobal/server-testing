'use strict';

/**
 * PATCH /api/company/update-company/register-process/:id — el paso de Stripe del
 * alta de compañía (dashboard: RegisterStripeConnectedAccount.jsx). Sin sesión a
 * propósito: el admin todavía no la tiene mientras termina el registro.
 *
 * Antes (hasta 2026-11-03) esta ruta llamaba a `updatingCompany`, que guarda el
 * body ENTERO: cualquiera con el id de una compañía podía reescribirla
 * (employees, roles, nombre) o reapuntar su `stripe_connected_account`, la
 * cuenta a la que van los cobros. Además está en PUBLIC_ROUTES de
 * companyAuth.js, así que ni COMPANY_AUTH_MODE=enforce la cerraba (AC-3, AC-6).
 *
 * Ahora solo hace lo que el registro necesita:
 *   - escribe `stripe_connected_account` y nada más (otros campos se ignoran);
 *   - una vez por entorno (test / live): si ese entorno ya tiene cuenta, 409.
 *     La condición va en el propio update, así que es atómica;
 *   - solo en compañías creadas hace REGISTRATION_WINDOW_MS como mucho (por la
 *     fecha del ObjectId): las antiguas sin cuenta tampoco se pueden reclamar.
 * Cambiar una cuenta ya conectada, o conectar una fuera de plazo, va por
 * PATCH /update-company/:id, con sesión y permiso company:update.
 *
 * Forma del valor, la que manda el dashboard:
 *   { test: { id: "acct_...", login_links: {...} } | null, live: ... | null }
 * También vale la cadena "acct_..." en lugar del objeto.
 */

const REGISTRATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ENVS = ['test', 'live'];
const ACCT = /^acct_[A-Za-z0-9]{1,64}$/;

const accountIdOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.id : undefined);

/** { env: valor } a escribir, o un mensaje de error. */
function parseAccounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'stripe_connected_account must be an object with test and/or live.' };
  }
  const writes = {};
  for (const [env, v] of Object.entries(value)) {
    if (!ENVS.includes(env)) return { error: `Unknown Stripe environment: ${env}.` };
    if (v == null) continue;
    if (!ACCT.test(String(accountIdOf(v) ?? ''))) return { error: `Invalid connected account for ${env}.` };
    writes[env] = typeof v === 'string' ? v : { id: v.id, ...(v.login_links ? { login_links: v.login_links } : {}) };
  }
  if (!Object.keys(writes).length) return { error: 'No connected account to link.' };
  return { writes };
}

function createLinkStripeAccountAtRegistration({ Company, isValidObjectId, now = () => Date.now(), logger }) {
  return async function linkStripeAccountAtRegistration(request, response) {
    try {
      const { id } = request.params;
      if (!isValidObjectId(id)) return response.status(400).json({ ok: false, msg: 'Invalid company id.' });

      const createdAt = parseInt(String(id).slice(0, 8), 16) * 1000;
      if (now() - createdAt > REGISTRATION_WINDOW_MS) {
        return response.status(403).json({
          ok: false,
          msg: 'Registration window closed. Sign in to connect a Stripe account.',
        });
      }

      const { writes, error } = parseAccounts(request.body?.stripe_connected_account);
      if (error) return response.status(400).json({ ok: false, msg: error });

      // Atómico: solo escribe si los entornos que se piden siguen vacíos.
      const filter = { _id: id };
      const set = {};
      for (const [env, v] of Object.entries(writes)) {
        filter[`stripe_connected_account.${env}`] = null;
        set[`stripe_connected_account.${env}`] = v;
      }
      const updated = await Company.findOneAndUpdate(filter, { $set: set }, { new: true })
        .select('company_name stripe_connected_account')
        .lean();

      if (!updated) {
        const exists = await Company.exists({ _id: id });
        if (!exists) return response.status(404).json({ ok: false, msg: 'Company not found.' });
        logger?.warn?.('register-process: connected account already linked', { companyId: id, envs: Object.keys(writes) });
        return response.status(409).json({
          ok: false,
          msg: 'A Stripe account is already linked. Sign in to change it.',
        });
      }
      return response.status(201).json({ ok: true, company: updated });
    } catch (err) {
      logger?.error?.(err);
      return response.status(500).json({ ok: false, msg: 'Please contact Administrator' });
    }
  };
}

let defaultHandler = null;
const linkStripeAccountAtRegistration = (req, res) => {
  if (!defaultHandler) {
    defaultHandler = createLinkStripeAccountAtRegistration({
      Company: require('../models/Company'),
      isValidObjectId: require('mongoose').isValidObjectId,
      logger: require('../helpers/logger'),
    });
  }
  return defaultHandler(req, res);
};

module.exports = {
  createLinkStripeAccountAtRegistration,
  linkStripeAccountAtRegistration,
  REGISTRATION_WINDOW_MS,
};
