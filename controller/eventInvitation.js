'use strict';

/**
 * Invitaciones a un evento con confirmación de asistencia — Fase 4.3 de
 * PLAN_rutas_sin_autenticacion_2026-10-14.md (y Fases 1-2 de
 * PLAN_event_invitation_responses_2026-10-08.md).
 *
 * Antes el dashboard armaba el correo y el enlace en el navegador
 * (eventRegistrationUtils.buildConfirmationLink) con todos los datos en claro, y
 * la página pública /attendance-confirmation confirmaba con las rutas genéricas
 * de consumidor (user-query, POST /auth/new, PATCH /auth/:id, new_consumer).
 * Cualquiera podía fabricar un enlace y apuntar a quien quisiera a un evento.
 *
 * Ahora:
 *   - POST /send (staff): el servidor saca miembro, destinatario y evento de la
 *     BD, firma el enlace (helpers/emailLinkToken.js, 5 días, un solo uso) y
 *     manda el correo.
 *   - POST /confirm (público, con el token): la confirmación la hace el servidor
 *     con los datos del token, no del body. Gasta el token.
 *   - POST /response (público): registra lo que hace quien abre el enlace
 *     (`opened`, `failed`). Con token, la fila sale `verified: true`.
 */

const { isValidObjectId } = require('mongoose');
const getConnection = require('../mysql/database/config');
const Event = require('../models/Event');
const Company = require('../models/Company');
const AdminUser = require('../models/AdminUser');
const User = require('../models/User');
const logger = require('../helpers/logger');
const { enqueue } = require('../helpers/queue');
const { clientRedis } = require('../database/cacheMemoryConfig');
const { findCompanyMembership } = require('../helpers/companyMembership');
const {
  signEmailLinkToken,
  readEmailLinkToken,
  consumeEmailLinkToken,
  releaseEmailLinkToken,
} = require('../helpers/emailLinkToken');
const { logStaffActivity } = require('./staffActivityLog');
const { resolveBranding, applyBrandedEnvelope } = require('../nodeMailer/branding');
const { renderBrandedEmail, paragraph, escapeHtml } = require('../nodeMailer/emailLayout');

const PURPOSE = 'event_attendance';
const MAX_MEMBERS_PER_SEND = 500;
const RESPONSES = ['opened', 'confirmed', 'already_confirmed', 'failed'];

/** off | warn | enforce — ver middlewares/attendanceLinkAuth.js. */
const mode = () => String(process.env.ATTENDANCE_LINK_MODE || 'warn').toLowerCase();

const linkTokenOf = (req) =>
  (typeof req.header === 'function' ? req.header('x-link-token') : req.headers?.['x-link-token']) ||
  req.body?.link_token ||
  null;

const text = (value, max = 254) => String(value ?? '').trim().slice(0, max);
const isMinor = (member) => member?.minor === true || Number(member?.minor) === 1;

const frontendUrl = () => String(process.env.FRONTEND_URL || 'https://admin.devitrak.net').replace(/\/$/, '');

/* ───────────────────────────────────────────────────────────── registro ── */

/**
 * Una fila en el log de actividad por cada paso de quien responde. Sin sesión:
 * actor anónimo, con el email al que se mandó el enlace. `company_id` es el de
 * Mongo, que es con lo que el reporte filtra (si no, la fila no la ve nadie).
 */
const recordResponse = (req, subject, response, { verified, reason } = {}) =>
  logStaffActivity({
    actor_type: 'anonymous',
    actor: { email: subject.responder_email || undefined },
    company_id: subject.company_id,
    action: response === 'opened' ? 'OPEN' : 'RESPOND',
    target_model: 'EventInvitation',
    target_id: subject.event_id,
    context: {
      event_id: subject.event_id,
      event_name: subject.event_name,
      member_id: subject.member_id || undefined,
    },
    details: {
      response,
      responder_role: subject.responder_role,
      member_email: subject.member_email,
      ...(reason ? { reason: text(reason, 500) } : {}),
      verified,
      route: req.originalUrl || req.url,
      server_received_at: new Date().toISOString(),
    },
    ip_address: req.ip || '',
    device_info: (typeof req.header === 'function' && req.header('user-agent')) || '',
    timestamp: new Date(),
  });

/* ──────────────────────────────────────────────────────────────── envío ── */

const formatDate = (value) => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

// El mismo texto que mandaba el dashboard (eventRegistrationUtils.buildAttendanceEmail),
// con el layout de marca del servidor.
const buildInvitationEmail = ({ claims, event, link, branding }) => {
  const memberName = `${claims.member_first_name} ${claims.member_last_name}`.trim() || 'this member';
  const begin = formatDate(event?.eventInfoDetail?.dateBegin);
  const end = formatDate(event?.eventInfoDetail?.dateEnd);
  const dates = begin && end && begin !== end ? `${begin} - ${end}` : begin || end;
  const subject = `Please confirm attendance for ${claims.event_name}`;

  const html = renderBrandedEmail({
    branding,
    title: subject,
    greeting:
      claims.responder_role === 'guardian'
        ? `You are receiving this message on behalf of ${memberName}.`
        : `Hi ${memberName},`,
    intro: [
      `You have been invited to attend ${claims.event_name}${dates ? ` (${dates})` : ''}.`,
      'Please confirm attendance by clicking the button below. The link works once and expires in 5 days.',
    ],
    cta: { label: 'Confirm attendance', href: link },
    blocks: [
      paragraph(
        `If the button doesn't work, copy and paste this link into your browser:<br/><span style="word-break: break-all;">${escapeHtml(link)}</span>`,
        { html: true, muted: true },
      ),
    ],
  });

  return {
    from: 'Devitrak Notifications <noreply@devitrak.com>',
    to: claims.responder_email,
    subject,
    html,
  };
};

/**
 * POST /api/school/event-invitations/send — staff con member:create.
 * Body: { company_id (SQL), event_id (Mongo), member_ids: [...] }.
 *
 * Del cliente solo se toman ids. El destinatario (el miembro, o su tutor si es
 * menor) sale de members_info; el evento y su compañía, de Mongo. Quien envía
 * tiene que ser miembro de la compañía dueña del evento.
 */
const sendEventInvitations = async (req, res) => {
  try {
    const { company_id: sqlCompanyId, event_id: eventId, member_ids: memberIds } = req.body ?? {};
    if (!isValidObjectId(eventId)) {
      return res.status(400).json({ ok: false, msg: 'event_id is required' });
    }
    if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.length > MAX_MEMBERS_PER_SEND) {
      return res.status(400).json({ ok: false, msg: `member_ids must list 1 to ${MAX_MEMBERS_PER_SEND} members` });
    }

    const event = await Event.findById(eventId)
      .select('company_id eventInfoDetail.eventName eventInfoDetail.dateBegin eventInfoDetail.dateEnd')
      .lean();
    const companyId = event?.company_id ? String(event.company_id) : null;
    const admin = await AdminUser.findById(req.uid).select('email super_user active').lean();
    const allowed =
      companyId && admin && admin.active !== false &&
      (admin.super_user || (await findCompanyMembership(companyId, admin)));
    if (!allowed) return res.status(404).json({ ok: false, msg: 'Event not found' });

    const company = await Company.findById(companyId).select('company_name').lean();
    const eventName = event.eventInfoDetail?.eventName || '';
    const ids = [...new Set(memberIds.map((id) => String(id)))];
    const [members] = await getConnection().query(
      `SELECT member_id, first_name, last_name, email, minor, parent_guardian_email
         FROM members_info WHERE company_id = ? AND member_id IN (?)`,
      [sqlCompanyId, ids],
    );
    const byId = new Map(members.map((m) => [String(m.member_id), m]));
    const branding = await resolveBranding({}, { request: { verifiedCompanyId: companyId } });

    const results = [];
    for (const memberId of ids) {
      const member = byId.get(memberId);
      if (!member) {
        results.push({ member_id: memberId, ok: false, error: 'Member not found in this company.' });
        continue;
      }
      const guardian = isMinor(member);
      const recipient = text(guardian ? member.parent_guardian_email : member.email);
      if (!recipient) {
        results.push({
          member_id: memberId,
          ok: false,
          error: guardian ? 'Missing guardian email for this minor member.' : 'Member has no email address.',
        });
        continue;
      }

      const claims = {
        company_id: companyId,
        company_name: company?.company_name || '',
        event_id: String(eventId),
        event_name: eventName,
        member_id: memberId,
        member_email: text(member.email),
        member_first_name: text(member.first_name, 100),
        member_last_name: text(member.last_name, 100),
        responder_email: recipient,
        responder_role: guardian ? 'guardian' : 'member',
      };
      // Los mismos parámetros que leía la página (para mostrar), más el token,
      // que es lo único que el servidor cree.
      const params = new URLSearchParams({
        memberEmail: claims.member_email,
        memberFirstName: claims.member_first_name,
        memberLastName: claims.member_last_name,
        eventId: claims.event_id,
        eventName: claims.event_name,
        company: claims.company_name,
        companyId: claims.company_id,
        minor: guardian ? 'true' : 'false',
        guardianEmail: guardian ? recipient : '',
        memberId,
        token: signEmailLinkToken(PURPOSE, claims),
      });
      const link = `${frontendUrl()}/attendance-confirmation?${params.toString()}`;

      try {
        const message = applyBrandedEnvelope(buildInvitationEmail({ claims, event, link, branding }), branding);
        await enqueue('send-email', message);
        results.push({ member_id: memberId, ok: true });
      } catch (error) {
        logger.error('event invitation: could not enqueue the email', { member_id: memberId, error: error.message });
        results.push({ member_id: memberId, ok: false, error: 'The email could not be queued.' });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    return res.status(200).json({ ok: true, sent, failed: results.length - sent, results });
  } catch (error) {
    logger.error('event invitation: send failed', { error: error.message });
    return res.status(500).json({ ok: false, msg: 'Could not send the invitations.' });
  }
};

/* ────────────────────────────────────────────────────────── confirmación ── */

const inEvent = (user, eventId) =>
  Array.isArray(user?.event_providers) && user.event_providers.some((id) => String(id) === String(eventId));

/**
 * POST /api/school/event-invitations/confirm — público, exige el token.
 *
 * Lo mismo que hacía la página con cuatro llamadas genéricas
 * (eventRegistrationUtils.registerConsumerToEvent), pero con los datos del
 * token: el consumidor se busca por el email del miembro; si existe se le añade
 * el evento, si no se crea en Mongo y en SQL. Idempotente: si ya está en el
 * evento responde `already` sin gastar el token.
 */
const confirmEventInvitation = async (req, res) => {
  const claims = readEmailLinkToken(PURPOSE, linkTokenOf(req));
  if (!claims) {
    return res.status(401).json({ ok: false, msg: 'This confirmation link is invalid or expired.' });
  }

  let consumed = null;
  try {
    const existing = await User.findOne({ email: claims.member_email }).sort({ _id: -1 });
    if (existing && inEvent(existing, claims.event_id)) {
      recordResponse(req, claims, 'already_confirmed', { verified: true });
      return res.status(200).json({ ok: true, outcome: 'already' });
    }

    consumed = await consumeEmailLinkToken(claims);
    if (consumed === 'already_used') {
      return res.status(410).json({ ok: false, msg: 'This link has already been used.' });
    }

    if (existing) {
      await User.updateOne(
        { _id: existing._id },
        {
          $addToSet: {
            eventSelected: claims.event_name,
            provider: claims.company_name,
            company_providers: claims.company_id,
            event_providers: claims.event_id,
          },
        },
      );
    } else {
      await User.create({
        name: claims.member_first_name,
        lastName: claims.member_last_name,
        email: claims.member_email,
        privacyPolicy: true,
        category: 'Regular',
        provider: [claims.company_name],
        eventSelected: [claims.event_name],
        company_providers: [claims.company_id],
        event_providers: [claims.event_id],
        groupName: [],
      });
      await getConnection().execute(
        'INSERT INTO consumer_info (first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?)',
        [claims.member_first_name, claims.member_last_name, claims.member_email, '000-000-0000'],
      );
    }

    // La lista de consumidores del evento que cachea GET /api/auth/user-query.
    clientRedis()
      .then((client) => client.del(`event=${claims.event_id}&company=${claims.company_id}`))
      .catch(() => {});

    recordResponse(req, claims, 'confirmed', { verified: true });
    return res.status(200).json({ ok: true, outcome: 'confirmed' });
  } catch (error) {
    if (consumed === 'consumed') await releaseEmailLinkToken(claims);
    logger.error('event invitation: confirmation failed', { error: error.message });
    recordResponse(req, claims, 'failed', { verified: true, reason: error.message });
    return res.status(500).json({ ok: false, msg: 'The confirmation was not saved. Please try again.' });
  }
};

/* ─────────────────────────────────────────────────────────── respuestas ── */

/**
 * POST /api/school/event-invitations/response — público.
 *
 * Con token: solo `opened` y `failed` (confirmed / already_confirmed los
 * registra /confirm, que es quien sabe si de verdad pasó); los datos salen del
 * token y la fila va `verified: true`.
 *
 * Sin token (enlaces enviados antes de este cambio): se acepta mientras
 * ATTENDANCE_LINK_MODE no sea `enforce`, con los datos del body comprobados
 * contra la BD (el evento tiene que ser de esa compañía), y la fila va
 * `verified: false`: no prueba quién respondió.
 */
const recordEventInvitationResponse = async (req, res) => {
  const body = req.body ?? {};
  const response = body.response;
  const claims = readEmailLinkToken(PURPOSE, linkTokenOf(req));

  if (claims) {
    if (!['opened', 'failed'].includes(response)) {
      return res.status(400).json({ ok: false, msg: 'response must be opened or failed' });
    }
    recordResponse(req, claims, response, { verified: true, reason: body.reason });
    return res.status(201).json({ ok: true });
  }

  if (mode() === 'enforce') {
    return res.status(401).json({ ok: false, msg: 'This confirmation link is invalid or expired.' });
  }

  const { company_id: companyId, event_id: eventId } = body;
  if (!isValidObjectId(companyId) || !isValidObjectId(eventId)) {
    return res.status(400).json({ ok: false, msg: 'company_id and event_id are required' });
  }
  if (!RESPONSES.includes(response) || !['guardian', 'member'].includes(body.responder_role) || !text(body.member_email)) {
    return res.status(400).json({ ok: false, msg: 'member_email, responder_role and response are required' });
  }
  const event = await Event.findOne({ _id: eventId, company_id: companyId })
    .select('eventInfoDetail.eventName')
    .lean();
  if (!event) return res.status(404).json({ ok: false, msg: 'Event not found' });

  logger.warn('event invitation: response without a link token (mode=warn)', { event_id: eventId, ip: req.ip });
  recordResponse(
    req,
    {
      company_id: companyId,
      event_id: eventId,
      event_name: event.eventInfoDetail?.eventName || '',
      member_id: text(body.member_id, 64) || null,
      member_email: text(body.member_email),
      responder_email: text(body.responder_email) || null,
      responder_role: body.responder_role,
    },
    response,
    { verified: false, reason: body.reason },
  );
  return res.status(201).json({ ok: true });
};

module.exports = {
  EVENT_ATTENDANCE_PURPOSE: PURPOSE,
  sendEventInvitations,
  confirmEventInvitation,
  recordEventInvitationResponse,
};
