'use strict';

/**
 * Acceso a la página pública /display-contracts del dashboard (firma de
 * contratos del consumidor) — Fase 4.1 de PLAN_rutas_sin_autenticacion_2026-10-14.md.
 *
 * Antes bastaba con conocer los ids que van en la URL (company_id,
 * consumer_member_id, verification_id, contract_url) para leer los datos del
 * consumidor y firmar en su nombre. Ahora el enlace del correo lleva un token
 * firmado por el servidor (helpers/emailLinkToken.js, propósito
 * `contract_signing`) que la página manda en la cabecera `x-link-token`.
 *
 * Cada ruta acepta, en este orden:
 *   1. sesión de staff válida (el dashboard con sesión usa las mismas rutas);
 *   2. si la ruta también la usa la app del consumidor (`sharedWithConsumerApp`)
 *      y la petición no viene del dashboard: pasa, como hasta ahora;
 *   3. un token del enlace cuyos ids coinciden con los de la petición. Un token
 *      del consumidor A no sirve para leer ni firmar lo del consumidor B.
 * La ruta de la acción final (`consume`) gasta el token: un segundo intento
 * responde 410.
 *
 * Modo por CONTRACT_LINK_MODE, como NODEMAILER_AUTH_MODE:
 *   `warn` (por defecto) registra lo que enforce rechazaría y deja pasar. Los
 *     correos enviados antes de este cambio no llevan token y siguen vivos;
 *     pasar a `enforce` 5 días después del despliegue (la vida máxima del token).
 *   `enforce` responde 401 (sin token / no coincide) y 410 (ya usado).
 *   `off` desactiva la comprobación.
 */

const { isValidObjectId } = require('mongoose');
const logger = require('../helpers/logger');
const AdminUser = require('../models/AdminUser');
const User = require('../models/User');
const VerificationConsumersLeaseContracts = require('../models/VerificationConsumersLeaseContracts');
const { findCompanyMembership } = require('../helpers/companyMembership');
const {
  signEmailLinkToken,
  readEmailLinkToken,
  consumeEmailLinkToken,
  releaseEmailLinkToken,
} = require('../helpers/emailLinkToken');
const { isStaffSession, isStaffOrigin } = require('../helpers/consumerUserFilter');

const PURPOSE = 'contract_signing';

const mode = () => String(process.env.CONTRACT_LINK_MODE || 'warn').toLowerCase();

const linkToken = (req) =>
  (typeof req.header === 'function' ? req.header('x-link-token') : req.headers?.['x-link-token']) ||
  req.body?.link_token ||
  null;

// Todos los ids que la ruta lee de la petición tienen que estar y ser iguales
// a los del token.
const matches = (claims, subject) =>
  Object.entries(subject).every(
    ([key, value]) => value != null && value !== '' && String(claims[key]) === String(value),
  );

/**
 * @param {{
 *   subject: (req) => object,        ids de la petición, con los nombres del token
 *   consume?: boolean,                es la acción final: gasta el token
 *   sharedWithConsumerApp?: boolean,  la app del consumidor también la llama sin token
 * }} opts
 */
function contractLinkGate({ subject, consume = false, sharedWithConsumerApp = false }) {
  return async (req, res, next) => {
    const currentMode = mode();
    if (currentMode === 'off') return next();

    try {
      if (await isStaffSession(req)) return next();
    } catch (error) {
      logger.warn('contract link: no se pudo comprobar la sesión de staff', { error: error.message });
    }
    if (sharedWithConsumerApp && !isStaffOrigin(req)) return next();

    const enforce = currentMode === 'enforce';
    const detail = {
      route: req.originalUrl || req.url,
      origin: typeof req.header === 'function' ? req.header('origin') : undefined,
      ip: req.ip,
    };
    const refuse = (status, msg, reason) => {
      if (!enforce) {
        logger.warn(`contract link: ${reason} (mode=warn, se deja pasar)`, detail);
        return next();
      }
      logger.warn(`contract link: ${reason}`, detail);
      return res.status(status).json({ ok: false, msg });
    };

    const claims = readEmailLinkToken(PURPOSE, linkToken(req));
    if (!claims) return refuse(401, 'A valid link from the email is required.', 'sin token o token inválido');
    if (!matches(claims, subject(req))) {
      return refuse(401, 'This link is not valid for this document.', 'el token no coincide con la petición');
    }
    req.contractLink = claims;

    if (!consume) return next();

    const outcome = await consumeEmailLinkToken(claims);
    if (outcome === 'already_used') {
      return refuse(410, 'This link has already been used.', 'token ya usado');
    }
    if (outcome === 'unavailable') {
      // El controller comprueba igualmente si ya está firmado.
      logger.warn('contract link: Redis no disponible, no se pudo marcar el token como usado', detail);
    } else {
      // Si la firma no llega a hacerse, el enlace tiene que seguir valiendo.
      res.on('finish', () => {
        if (res.statusCode >= 400) releaseEmailLinkToken(claims);
      });
    }
    return next();
  };
}

/**
 * Para POST /api/nodemailer/liability-contract-consumer-email-notification:
 * deja en `body.contract_link_tokens` un token por contrato ({ [view_url]: token })
 * que returningDeviceMessage.js añade al enlace.
 *
 * El body lo manda el cliente, así que nada de él se firma a ciegas. Solo hay
 * token si quien pide el correo es staff con sesión vigente y miembro de la
 * compañía de la verificación, la verificación es de ese consumidor y de esa
 * compañía, y el correo va al email que el consumidor tiene en BD. Si algo no
 * cuadra, el correo sale igual, con el enlace sin token (que en enforce no
 * abre): mejor eso que firmar un enlace hacia el buzón de otro.
 */
async function attachContractLinkTokens(req, _res, next) {
  const body = req.body ?? {};
  delete body.contract_link_tokens;
  const skip = (reason) => {
    logger.warn(`contract link: correo sin token (${reason})`, { verification_id: body.verification_id });
    return next();
  };

  try {
    const session = req.notificationSession;
    if (!session?.uid) return skip('sin sesión de staff');
    const consumer = body.consumer ?? {};

    const admin = await AdminUser.findById(session.uid).select('email super_user active tokenVersion').lean();
    if (!admin || admin.active === false || admin.tokenVersion !== session.tokenVersion) {
      return skip('sesión de staff no vigente');
    }
    const verification = isValidObjectId(body.verification_id)
      ? await VerificationConsumersLeaseContracts.findById(body.verification_id).lean()
      : null;
    if (!verification) return skip('verificación inexistente');

    const companyId = String(verification.company_id);
    const consumerId = String(verification.consumer_member_id);
    if (consumerId !== String(consumer.consumer_member_id) || companyId !== String(body.company_id)) {
      return skip('la verificación no es de ese consumidor o compañía');
    }
    if (!admin.super_user && !(await findCompanyMembership(companyId, admin))) {
      return skip('el staff no pertenece a la compañía');
    }
    const user = await User.findById(consumerId).select('email').lean();
    const normalize = (email) => String(email ?? '').trim().toLowerCase();
    if (!user?.email || normalize(user.email) !== normalize(consumer.email)) {
      return skip('el email no es el del consumidor');
    }

    const urls = new Set((verification.contract_list ?? []).map((c) => c.document_url));
    const tokens = {};
    for (const contract of Array.isArray(body.contract_list) ? body.contract_list : []) {
      const url = contract?.view_url;
      if (!url || !urls.has(url)) continue;
      tokens[url] = signEmailLinkToken(PURPOSE, {
        company_id: companyId,
        consumer_member_id: consumerId,
        verification_id: String(verification._id),
        contract_url: url,
      });
    }
    body.contract_link_tokens = tokens;
  } catch (error) {
    logger.error('contract link: no se pudo generar el token del correo', { error: error.message });
  }
  return next();
}

module.exports = { contractLinkGate, attachContractLinkTokens, CONTRACT_LINK_PURPOSE: PURPOSE };
