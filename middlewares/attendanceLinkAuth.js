'use strict';

/**
 * Cierre de las rutas genéricas de consumidor para el dashboard sin sesión —
 * Fase 4.3 de PLAN_rutas_sin_autenticacion_2026-10-14.md.
 *
 * La página pública /attendance-confirmation confirmaba con cuatro rutas
 * genéricas: POST /api/auth/user-query, POST /api/auth/new, PATCH /api/auth/:id
 * y POST /api/db_consumer/new_consumer. Ahora tiene su propia ruta con token
 * (POST /api/school/event-invitations/confirm), así que desde admin.devitrak.net
 * esas cuatro ya solo deberían llegar con sesión de staff.
 *
 * NO afecta a la app del consumidor (app.devitrak.net), que las llama sin token
 * por diseño: solo mira lo que viene del origen del dashboard.
 *
 * ATTENDANCE_LINK_MODE:
 *   `warn` (por defecto) registra cada llamada del dashboard sin sesión y la deja
 *     pasar: los enlaces enviados antes de este cambio siguen usando el camino
 *     viejo hasta que caduquen. Es también la lista que hay que mirar antes de
 *     pasar a enforce, por si alguna otra página pública las usa.
 *   `enforce` responde 401. Pasar 5 días después de desplegar el dashboard que
 *     usa /confirm.
 *   `off` desactiva la comprobación.
 */

const rateLimit = require('express-rate-limit');
const logger = require('../helpers/logger');
const { isStaffOrigin, isStaffSession } = require('../helpers/consumerUserFilter');

const mode = () => String(process.env.ATTENDANCE_LINK_MODE || 'warn').toLowerCase();

const requireSessionFromDashboard = async (req, res, next) => {
  const currentMode = mode();
  if (currentMode === 'off' || !isStaffOrigin(req)) return next();
  try {
    if (await isStaffSession(req)) return next();
  } catch (error) {
    logger.warn('attendance link: no se pudo comprobar la sesión de staff', { error: error.message });
  }

  const detail = { route: req.originalUrl || req.url, method: req.method, ip: req.ip };
  if (currentMode === 'enforce') {
    logger.warn('attendance link: refused a dashboard call without session', detail);
    return res.status(401).json({ ok: false, msg: 'Authentication is required for this endpoint.' });
  }
  logger.warn('attendance link: dashboard call without session allowed (mode=warn)', detail);
  return next();
};

/**
 * Para /event-invitations/confirm y /response, que responden sin sesión. Por
 * IP, y holgado: un colegio entero detrás de la misma IP abre sus enlaces el
 * mismo día, y cada visita manda 2 o 3 llamadas. Por proceso (limitación
 * conocida de los limitadores en memoria): es un freno, no una garantía.
 */
const publicInvitationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, msg: 'Too many requests. Please try again shortly.' },
});

module.exports = { requireSessionFromDashboard, publicInvitationRateLimit };
