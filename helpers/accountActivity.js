'use strict';

/**
 * Datos de uso de la cuenta de staff en AdminUser (AC-2, AC-7, AU-3; 2026-11-09).
 *
 *   login correcto  -> lastLoginAt, lastLoginIp, lastLoginUserAgent, loginCount + 1
 *   login fallido   -> lastFailedLoginAt (solo si el email es de una cuenta)
 *
 * lastLoginAt es también la fecha de la desactivación por inactividad
 * (scheduler/staffInactivity.js). passwordChangedAt lo pone un hook del modelo.
 *
 * Se llaman sin esperar y nunca fallan: un error aquí no puede romper el
 * login. Sin Mongo conectado (tests con stubs) no hacen nada, para no quedarse
 * en el buffer de mongoose.
 */

const MAX_USER_AGENT = 512;

function fire(AdminUserModel, uid, update, connected) {
  try {
    const ready = connected ?? require('mongoose').connection.readyState === 1;
    if (!ready || !uid || typeof AdminUserModel?.updateOne !== 'function') return;
    Promise.resolve(AdminUserModel.updateOne({ _id: uid }, update)).catch(() => {});
  } catch {}
}

function recordSuccessfulLogin(AdminUserModel, uid, { ip, userAgent, now = new Date(), connected } = {}) {
  fire(
    AdminUserModel,
    uid,
    {
      $set: {
        lastLoginAt: now,
        lastLoginIp: ip ? String(ip) : null,
        lastLoginUserAgent: userAgent ? String(userAgent).slice(0, MAX_USER_AGENT) : null,
      },
      $inc: { loginCount: 1 },
    },
    connected
  );
}

function recordFailedLogin(AdminUserModel, uid, { now = new Date(), connected } = {}) {
  fire(AdminUserModel, uid, { $set: { lastFailedLoginAt: now } }, connected);
}

module.exports = { recordSuccessfulLogin, recordFailedLogin, MAX_USER_AGENT };
