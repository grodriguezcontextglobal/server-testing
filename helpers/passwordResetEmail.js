'use strict';

/**
 * El correo de "reset your password" de staff, compartido por:
 *   - POST /api/nodemailer/reset-admin-password ("Forgot password" y el botón
 *     "Send a new email" tras un reset de MFA), vía attachPasswordResetLink;
 *   - POST /api/admin/mfa/reset/:id (FedRAMP A5, 2026-11-03): tras un reset de
 *     MFA la persona vuelve a enrolarse SOLO desde este enlace, que prueba que
 *     controla el buzón. Ver reports/BACKEND_fedramp_a5_reset_email_step_REPLY_2026-10-30.md.
 *
 * El enlace lo firma el servidor (helpers/passwordResetToken.js): dura 1 h y deja
 * de valer cuando cambia la contraseña.
 *
 * Límite: MAX_PER_HOUR correos por cuenta y hora, en Redis. Sin Redis no se
 * limita (igual que el bloqueo de login): mejor que nadie pueda recuperar su
 * cuenta durante una caída.
 */

const { generatePasswordResetToken } = require('./passwordResetToken');

const MAX_PER_HOUR = 3;
const WINDOW_SECONDS = 60 * 60;

async function buildPasswordResetLink(adminUser, { origin = process.env.FRONTEND_URL || 'https://admin.devitrak.net' } = {}) {
  const params = new URLSearchParams({
    token: await generatePasswordResetToken(adminUser),
    uid: String(adminUser.id ?? adminUser._id),
    email: adminUser.email,
    'stamp-time': new Date().toISOString(),
  });
  return `${origin}/reset-password?${params.toString()}`;
}

/** true si a esta cuenta aún le quedan correos en la hora. Cuenta este. */
async function takeResetEmailSlot(redis, userId) {
  if (!redis) return true;
  try {
    const key = `pwreset_mail:${userId}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, WINDOW_SECONDS);
    return n <= MAX_PER_HOUR;
  } catch {
    return true;
  }
}

/**
 * Encola el correo para `adminUser` (necesita `password` seleccionado: la firma
 * del enlace depende del hash). Devuelve true si quedó encolado.
 */
async function sendPasswordResetEmail(adminUser, { enqueueFn, buildMessage, redis, logger } = {}) {
  try {
    if (!(await takeResetEmailSlot(redis, adminUser.id ?? adminUser._id))) {
      logger?.warn?.('password reset email: hourly cap reached', { uid: String(adminUser.id ?? adminUser._id) });
      return false;
    }
    const message = buildMessage({
      contactInfo: { email: adminUser.email },
      linkToResetPassword: await buildPasswordResetLink(adminUser),
    });
    await enqueueFn('send-email', message);
    return true;
  } catch (error) {
    logger?.error?.('password reset email: could not queue', { err: error?.message });
    return false;
  }
}

module.exports = { buildPasswordResetLink, takeResetEmailSlot, sendPasswordResetEmail, MAX_PER_HOUR };
