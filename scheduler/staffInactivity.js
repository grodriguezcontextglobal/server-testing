'use strict';

/**
 * Cuentas de staff inactivas (FedRAMP/GovRAMP AC-2(3); 2026-11-09).
 *
 * Una cuenta de AdminUser que lleva STAFF_INACTIVITY_DAYS (90) sin entrar se
 * desactiva: `active: false`, con fecha y motivo, y `tokenVersion` + 1 por si
 * quedara algún token vivo. El login rechaza una cuenta desactivada
 * (controller/admin.js), y los middlewares ya rechazaban `active === false`.
 *
 * Inactividad = desde la MÁS RECIENTE de estas fechas:
 *   - lastLoginAt  (lo pone cada login correcto, helpers/accountActivity.js;
 *                   antes de 2026-11-09 no existía:
 *                   `node scripts/staff-inactivity.js --backfill` lo rellena
 *                   desde los LOGIN del audit trail);
 *   - el alta de la cuenta (la fecha del ObjectId): una cuenta recién creada
 *                   que aún no entró no cuenta como inactiva;
 *   - reactivatedAt (una reactivación da otros 90 días para entrar);
 *   - STAFF_INACTIVITY_SINCE, por defecto 2026-11-09 (el día en que empezó a
 *                   guardarse lastLoginAt): el reloj de TODAS las cuentas
 *                   empieza ese día, así que nadie se desactiva por logins
 *                   anteriores, y nadie antes del 2027-02-07. No se escribe
 *                   ninguna fecha inventada en la cuenta: es un suelo del cálculo.
 * Con sesiones de 12 h como máximo, cada uso del dashboard pasa por un login,
 * así que lastLoginAt mide el uso real.
 *
 * Es la identidad (el login) la que se desactiva, en todas sus compañías. La
 * baja de una compañía concreta sigue siendo Company.employees[].active.
 *
 * STAFF_INACTIVITY_MODE (lazy, como el resto de modos):
 *   warn (por defecto)  solo registra a quién desactivaría:
 *                       "staff inactivity: would disable ... (STAFF_INACTIVITY_MODE=warn)"
 *   enforce             desactiva
 *   off                 no hace nada
 * STAFF_INACTIVITY_DAYS       90 por defecto.
 * STAFF_INACTIVITY_EXEMPT     emails separados por comas que nunca se
 *                             desactivan (cuentas de servicio o de emergencia;
 *                             documentar cada una en el SSP).
 *
 * Corre a diario desde scheduler/index.js (03:15, hora del servidor).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
// Día en que se empezó a registrar el uso de las cuentas (lastLoginAt y demás).
const TRACKING_SINCE = '2026-11-09';

function inactivityConfig(env = process.env) {
  const rawMode = String(env.STAFF_INACTIVITY_MODE || 'warn').toLowerCase();
  const mode = ['warn', 'enforce', 'off'].includes(rawMode) ? rawMode : 'warn';
  const days = Number.parseInt(env.STAFF_INACTIVITY_DAYS, 10);
  const exempt = new Set(
    String(env.STAFF_INACTIVITY_EXEMPT || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  const parsedSince = new Date(`${String(env.STAFF_INACTIVITY_SINCE || '').trim()}T00:00:00Z`);
  const since = Number.isNaN(parsedSince.getTime()) ? new Date(`${TRACKING_SINCE}T00:00:00Z`) : parsedSince;
  return { mode, days: Number.isInteger(days) && days > 0 ? days : 90, exempt, since };
}

/** Fecha de alta: el timestamp del ObjectId. */
function createdAtOf(user) {
  const id = user?._id ?? user?.id;
  if (id && typeof id.getTimestamp === 'function') return id.getTimestamp();
  const hex = String(id ?? '');
  return /^[0-9a-f]{24}$/i.test(hex) ? new Date(parseInt(hex.slice(0, 8), 16) * 1000) : null;
}

/** La más reciente de lastLoginAt, alta, reactivatedAt y el suelo `since` (o null). */
function lastActivityOf(user, since = null) {
  const dates = [user?.lastLoginAt, createdAtOf(user), user?.reactivatedAt, since]
    .map((d) => (d ? new Date(d) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

/**
 * Qué cuentas activas superan el límite (sin tocar nada).
 * @returns {{ inactive: object[], exempt: object[] }} cada uno con
 *   { user, lastActivity, daysInactive }
 */
function findInactive(users, { now = new Date(), days, exempt, since = null }) {
  const inactive = [];
  const exempted = [];
  for (const user of users) {
    if (user.active === false) continue;
    const last = lastActivityOf(user, since);
    if (!last) continue;
    const daysInactive = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
    if (daysInactive < days) continue;
    const row = { user, lastActivity: last, daysInactive };
    if (exempt.has(String(user.email || '').toLowerCase())) exempted.push(row);
    else inactive.push(row);
  }
  return { inactive, exempt: exempted };
}

/**
 * El barrido diario.
 * @returns {{ mode, days, checked, inactive, disabled, exempt }}
 */
async function runStaffInactivity({
  AdminUserModel = require('../models/AdminUser'),
  logActivity = require('../controller/staffActivityLog').logStaffActivity,
  logger = require('../helpers/logger'),
  env = process.env,
  now = new Date(),
} = {}) {
  const { mode, days, exempt, since } = inactivityConfig(env);
  if (mode === 'off') return { mode, days, checked: 0, inactive: 0, disabled: 0, exempt: 0 };

  const users = await AdminUserModel.find({ active: { $ne: false } })
    .select('email lastLoginAt reactivatedAt super_user active')
    .lean();
  const found = findInactive(users, { now, days, exempt, since });

  let disabled = 0;
  for (const { user, lastActivity, daysInactive } of found.inactive) {
    const detail = {
      uid: String(user._id),
      email: user.email,
      last_activity: lastActivity.toISOString(),
      days_inactive: daysInactive,
      super_user: Boolean(user.super_user),
    };
    if (mode !== 'enforce') {
      logger.warn('staff inactivity: would disable account (STAFF_INACTIVITY_MODE=warn)', detail);
      continue;
    }
    // active != false en el filtro: si alguien la reactivó entre la lectura y
    // aquí, no se toca.
    const result = await AdminUserModel.updateOne(
      { _id: user._id, active: { $ne: false } },
      {
        $set: { active: false, deactivatedAt: now, deactivatedReason: 'inactivity' },
        $inc: { tokenVersion: 1 },
      }
    );
    if (!result?.modifiedCount) continue;
    disabled += 1;
    logger.warn('staff inactivity: account disabled', detail);
    await logActivity({
      staff_member_id: null,
      actor_type: 'anonymous',
      action: 'DEACTIVATE',
      target_model: 'AdminUser',
      target_id: String(user._id),
      details: { reason: 'inactivity', ...detail, by: 'scheduler/staffInactivity' },
    });
  }
  for (const { user, daysInactive } of found.exempt) {
    logger.info('staff inactivity: exempt account over the limit', { email: user.email, days_inactive: daysInactive });
  }

  return {
    mode,
    days,
    checked: users.length,
    inactive: found.inactive.length,
    disabled,
    exempt: found.exempt.length,
  };
}

module.exports = {
  TRACKING_SINCE,
  inactivityConfig,
  createdAtOf,
  lastActivityOf,
  findInactive,
  runStaffInactivity,
};
