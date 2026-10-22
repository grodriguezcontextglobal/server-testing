'use strict';

/**
 * Acceso de un consumidor EXISTENTE a la app del consumidor, por enlace de
 * correo (fase A del token de consumidor, 2026-10-21; contrato Q14 de
 * BACKEND_consumer_app_preguntas_REPLY_2026-10-15.md).
 *
 * El consumidor no tiene contraseña. Lo único que prueba que es él es su
 * buzón: el enlace lo firma el servidor (helpers/emailLinkToken.js, un solo
 * uso, 5 días) y solo viaja en el correo.
 *
 *   POST /api/auth/consumer-login-link { email, event_id }
 *     Responde SIEMPRE lo mismo, exista o no el email: la ruta no sirve para
 *     averiguar quién está registrado. Si existe, encola el correo.
 *
 *   POST /api/auth/consumer-session  (cabecera x-link-token o body.link_token)
 *     Canjea el enlace una vez y devuelve el consumidor y su token de sesión
 *     (helpers/consumerToken.js, nivel 'verified') para ese evento.
 *
 *   POST /api/auth/consumer-session  { email, event_id }, SIN enlace
 *     Solo en eventos con depósito (merchant): el depósito cubre el equipo y el
 *     consumidor entra con su email. Token de nivel 'email', limitado a ese
 *     evento. Sin depósito, 403: hay que entrar por el enlace. Regla del
 *     2026-10-22 (T1/T4 de FRONTEND_consumer_token_REPLY_2026-10-22.md).
 *
 * Las rutas viejas (/nodemailer/login-existing-consumer, enlace
 * /authentication/:event/:company/:uid) no se tocan hasta que la app migre.
 */

const { isValidObjectId } = require('mongoose');
const User = require('../models/User');
const Event = require('../models/Event');
const logger = require('../helpers/logger');
const { enqueue } = require('../helpers/queue');
const {
  signEmailLinkToken,
  readEmailLinkToken,
  consumeEmailLinkToken,
  releaseEmailLinkToken,
} = require('../helpers/emailLinkToken');
const { issueConsumerToken, loadTokenEvent } = require('../helpers/consumerToken');
const { resolveBranding, applyBrandedEnvelope } = require('../nodeMailer/branding');
const { renderBrandedEmail, paragraph, escapeHtml } = require('../nodeMailer/emailLayout');

const PURPOSE = 'consumer_login';
const GENERIC_OK = {
  ok: true,
  msg: 'If that email is registered, a sign-in link is on its way.',
};

const consumerAppUrl = () =>
  String(process.env.CONSUMER_APP_URL || 'https://app.devitrak.net').replace(/\/$/, '');

const linkTokenOf = (req) =>
  (typeof req.header === 'function' ? req.header('x-link-token') : req.headers?.['x-link-token']) ||
  req.body?.link_token ||
  null;

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

// Exacto pero sin distinguir mayúsculas: la app guarda en minúsculas, los
// consumidores antiguos no siempre. Escapado: el email no es un patrón.
const exactEmail = (email) => new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

const buildLoginEmail = ({ user, eventName, link, branding }) => {
  const subject = `Your sign-in link for ${eventName || 'Devitrak'}`;
  const name = `${user.name ?? ''} ${user.lastName ?? ''}`.trim();
  const html = renderBrandedEmail({
    branding,
    title: subject,
    greeting: name ? `Hi ${name},` : 'Hi,',
    intro: [
      `Use the button below to continue to ${eventName || 'your event'}.`,
      'The link works once and expires in 5 days. If you did not ask for it, you can ignore this email.',
    ],
    cta: { label: 'Continue', href: link },
    blocks: [
      paragraph(
        `If the button doesn't work, copy and paste this link into your browser:<br/><span style="word-break: break-all;">${escapeHtml(link)}</span>`,
        { html: true, muted: true },
      ),
    ],
  });
  return { from: 'Devitrak Notifications <noreply@devitrak.com>', to: user.email, subject, html };
};

const requestConsumerLoginLink = async (req, res, deps = {}) => {
  const { UserModel = User, EventModel = Event, enqueueFn = enqueue, branding: brandingFn = resolveBranding } = deps;
  const email = normalizeEmail(req.body?.email);
  const eventId = req.body?.event_id;
  if (!email || !isValidObjectId(eventId)) {
    return res.status(400).json({ ok: false, msg: 'email and event_id are required.' });
  }
  try {
    const event = await EventModel.findById(eventId).select('company_id eventInfoDetail.eventName').lean();
    if (!event) return res.status(200).json(GENERIC_OK);

    const user = await UserModel.findOne({ email: exactEmail(email) }).select('name lastName email').lean();
    if (!user) return res.status(200).json(GENERIC_OK);

    const companyId = event.company_id ? String(event.company_id) : null;
    const token = signEmailLinkToken(PURPOSE, {
      consumer_id: String(user._id),
      event_id: String(eventId),
      company_id: companyId,
    });
    const link = `${consumerAppUrl()}/authentication?token=${encodeURIComponent(token)}`;
    const branding = await brandingFn({}, { request: { verifiedCompanyId: companyId } });
    const message = applyBrandedEnvelope(
      buildLoginEmail({ user, eventName: event.eventInfoDetail?.eventName, link, branding }),
      branding,
    );
    await enqueueFn('send-email', message);
    return res.status(200).json(GENERIC_OK);
  } catch (error) {
    logger.error('consumer login link: could not send', { error: error.message });
    return res.status(500).json({ ok: false, msg: 'Could not send the sign-in link.' });
  }
};

const redeemConsumerSession = async (req, res, deps = {}) => {
  const {
    UserModel = User,
    issueToken = issueConsumerToken,
    consume = consumeEmailLinkToken,
    release = releaseEmailLinkToken,
  } = deps;
  const linkToken = linkTokenOf(req);
  if (!linkToken && req.body?.email) return merchantSession(req, res, deps);

  const claims = readEmailLinkToken(PURPOSE, linkToken);
  if (!claims) {
    return res.status(401).json({ ok: false, msg: 'This link is not valid or has expired.' });
  }

  const outcome = await consume(claims);
  if (outcome === 'already_used') {
    return res.status(410).json({ ok: false, msg: 'This link has already been used.' });
  }
  try {
    const user = await UserModel.findById(claims.consumer_id)
      .select('name lastName email phoneNumber')
      .lean();
    const token = user
      ? await issueToken(String(user._id), claims.event_id, { email: user.email, level: 'verified' })
      : null;
    if (!user || !token) {
      if (outcome === 'consumed') await release(claims);
      return res.status(404).json({ ok: false, msg: 'This account or event no longer exists.' });
    }
    return res.status(200).json({
      ok: true,
      consumer: {
        id: String(user._id),
        name: user.name,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
      event_id: claims.event_id,
      company_id: claims.company_id ?? null,
      level: 'verified',
      token,
    });
  } catch (error) {
    if (outcome === 'consumed') await release(claims);
    logger.error('consumer session: could not redeem', { error: error.message });
    return res.status(500).json({ ok: false, msg: 'Could not sign in.' });
  }
};

/** Entrada sin enlace en un evento con depósito: token de nivel 'email'. */
async function merchantSession(req, res, deps = {}) {
  const { UserModel = User, loadEvent = loadTokenEvent, issueToken = issueConsumerToken } = deps;
  const email = normalizeEmail(req.body?.email);
  const eventId = req.body?.event_id;
  if (!email || !isValidObjectId(eventId)) {
    return res.status(400).json({ ok: false, msg: 'email and event_id are required.' });
  }
  try {
    const event = await loadEvent(eventId);
    if (!event) return res.status(404).json({ ok: false, msg: 'Event not found.' });
    if (!event.merchant) {
      return res.status(403).json({
        ok: false,
        msg: 'This event requires the sign-in link sent by email.',
        verificationRequired: true,
      });
    }
    const user = await UserModel.findOne({ email: exactEmail(email) }).select('name lastName email').lean();
    if (!user) return res.status(404).json({ ok: false, msg: 'No account with that email.' });

    const token = await issueToken(String(user._id), eventId, { email: user.email, level: 'email' });
    if (!token) return res.status(404).json({ ok: false, msg: 'Event not found.' });
    // Sin teléfono: quien entra sin enlace solo ha demostrado conocer un email.
    return res.status(200).json({
      ok: true,
      consumer: { id: String(user._id), name: user.name, lastName: user.lastName, email: user.email },
      event_id: String(eventId),
      company_id: event.companyId,
      level: 'email',
      token,
    });
  } catch (error) {
    logger.error('consumer session (merchant): could not sign in', { error: error.message });
    return res.status(500).json({ ok: false, msg: 'Could not sign in.' });
  }
}

module.exports = {
  CONSUMER_LOGIN_PURPOSE: PURPOSE,
  requestConsumerLoginLink,
  redeemConsumerSession,
};
