'use strict';

/**
 * POST /api/company/event-staff/deactivate (AC-2, AC-6; 2026-11-04).
 *
 * Al cerrar un evento, quita el acceso a la compañía al staff que solo estaba
 * para ese evento. Antes lo decidía el dashboard y mandaba el array entero de
 * `employees` a PATCH /update-company/:id, que lo guardaba tal cual.
 *
 * Regla (la misma que tenía el dashboard, EndEventButton.jsx):
 *   - pierden el acceso: inventory_manager y assistant (en registros viejos sin
 *     roleType, el número 4 o 5);
 *   - lo conservan: root_admin, admin, sale_manager, event_manager, los roles
 *     con ámbito (location/category) y todo super_user.
 * Además, no se desactiva a quien esté en otro evento ACTIVO de la compañía:
 * el dashboard lo hacía y le quitaba el acceso que necesitaba para ese otro.
 *
 * El evento tiene que estar ya cerrado (active: false): la ruta no sirve para
 * echar al staff de un evento en curso.
 *
 * SQL: con `sqlCompanyId` en el body, pone company_staff.is_active = 0 a las
 * mismas personas, solo si quien llama tiene event:update en esa compañía SQL
 * (misma consulta que authorizePermission). Sin él, solo Mongo, como antes.
 *
 * Body: { eventId, sqlCompanyId? } · Compañía: x-company-id (authorizeMongoPermission).
 * 200 { ok, deactivated: [email], keptInOtherEvents: [email], sql: { updated } | { skipped } }
 */

const LOSES_ACCESS_ROLE_TYPES = new Set(['inventory_manager', 'assistant']);
const LOSES_ACCESS_LEGACY_ROLES = new Set(['4', '5']);

const eventStaffEmails = (event) => {
  const staff = event?.staff ?? {};
  const list = [...(staff.adminUser ?? []), ...(staff.headsetAttendees ?? [])];
  return new Set(
    list
      .map((s) => (typeof s === 'string' ? s : s?.email))
      .filter((e) => typeof e === 'string' && e)
      .map((e) => e.toLowerCase()),
  );
};

const losesAccess = (emp) => {
  if (!emp || emp.active === false || emp.super_user) return false;
  if (emp.roleType) return LOSES_ACCESS_ROLE_TYPES.has(emp.roleType);
  return LOSES_ACCESS_LEGACY_ROLES.has(String(emp.role ?? ''));
};

function createDeactivateEventStaff({
  Event = () => require('../models/Event'),
  Company = () => require('../models/Company'),
  getConnection = () => require('../mysql/database/config')(),
  resolveCompanyContext = (req) => require('../helpers/companyContext').resolveCompanyContext(req),
  logger = require('../helpers/logger'),
} = {}) {
  return async (request, response) => {
    try {
      const { eventId, sqlCompanyId } = request.body ?? {};
      const companyId = resolveCompanyContext(request);
      if (!eventId || typeof eventId !== 'string' || !/^[a-f0-9]{24}$/i.test(eventId)) {
        return response.status(400).json({ ok: false, msg: 'eventId is required' });
      }
      if (!companyId) {
        return response.status(400).json({ ok: false, msg: 'Company context (x-company-id) is required' });
      }

      const event = await Event().findById(eventId, { company_id: 1, staff: 1, active: 1 }).lean();
      if (!event || String(event.company_id) !== String(companyId)) {
        return response.status(404).json({ ok: false, msg: 'Event not found' });
      }
      if (event.active !== false) {
        return response.status(409).json({ ok: false, msg: 'End the event before removing its staff access' });
      }

      const company = await Company().findById(companyId, { employees: 1 }).lean();
      if (!company) return response.status(404).json({ ok: false, msg: 'Company not found' });

      const inEvent = eventStaffEmails(event);
      const candidates = (company.employees ?? [])
        .filter((emp) => typeof emp.user === 'string' && inEvent.has(emp.user.toLowerCase()) && losesAccess(emp))
        .map((emp) => emp.user);

      // Quien sigue en otro evento activo de la compañía conserva el acceso.
      const otherActive = await Event()
        .find({ company_id: String(companyId), active: true, _id: { $ne: eventId } }, { staff: 1 })
        .lean();
      const busy = new Set(otherActive.flatMap((e) => [...eventStaffEmails(e)]));
      const toDeactivate = candidates.filter((u) => !busy.has(u.toLowerCase()));
      const keptInOtherEvents = candidates.filter((u) => busy.has(u.toLowerCase()));

      if (toDeactivate.length > 0) {
        await Company().updateOne(
          { _id: companyId },
          { $set: { 'employees.$[e].active': false } },
          { arrayFilters: [{ 'e.user': { $in: toDeactivate }, 'e.super_user': { $ne: true } }] },
        );
      }

      const sql = await deactivateInSql({ request, sqlCompanyId, emails: toDeactivate, getConnection, logger });

      return response.status(200).json({ ok: true, deactivated: toDeactivate, keptInOtherEvents, sql });
    } catch (error) {
      logger.error('event-staff deactivate failed', { error: error.message });
      return response.status(500).json({ ok: false, msg: 'Could not remove event staff access' });
    }
  };
}

async function deactivateInSql({ request, sqlCompanyId, emails, getConnection, logger }) {
  if (sqlCompanyId === undefined || sqlCompanyId === null || sqlCompanyId === '') return { skipped: 'no_sql_company' };
  if (!Number.isInteger(Number(sqlCompanyId))) return { skipped: 'invalid_sql_company' };
  if (emails.length === 0) return { updated: 0 };
  try {
    const connection = getConnection();
    const [allowed] = await connection.query(
      `SELECT 1
       FROM company_staff cs
       JOIN role_permissions rp ON cs.role_id = rp.role_id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE cs.company_id = ? AND cs.staff_id = ? AND cs.is_active = 1
         AND p.resource = 'event' AND p.action = 'update'
       LIMIT 1`,
      [Number(sqlCompanyId), request.sqlStaffId ?? null],
    );
    if (!allowed.length) return { skipped: 'forbidden' };

    // Mismo filtro de rol que en Mongo: un admin con el mismo email en SQL no se toca.
    const [result] = await connection.query(
      `UPDATE company_staff cs
       JOIN staff_member sm ON sm.staff_id = cs.staff_id
       JOIN roles r ON r.id = cs.role_id
       SET cs.is_active = 0
       WHERE cs.company_id = ? AND cs.is_active = 1
         AND r.role_type IN ('inventory_manager', 'assistant')
         AND sm.email IN (?)`,
      [Number(sqlCompanyId), emails],
    );
    return { updated: result?.affectedRows ?? 0 };
  } catch (error) {
    logger.warn('event-staff deactivate: SQL step failed', { error: error.message });
    return { skipped: 'sql_error' };
  }
}

module.exports = {
  createDeactivateEventStaff,
  deactivateEventStaff: createDeactivateEventStaff(),
  losesAccess,
  eventStaffEmails,
};
