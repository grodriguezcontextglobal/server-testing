'use strict';

const AdminUser         = require('../models/AdminUser');
const Company           = require('../models/Company');
const { hasPermission } = require('../constants/rolePermissions');

/**
 * Middleware de autorización para rutas MongoDB.
 *
 * Fuente de verdad del rol:
 *   - Con company_id en el request → Company.employees (match por userId o email).roleType.
 *                                     Si no eres miembro activo de esa compañía → 403
 *                                     (NO cae al mirror global; evita escalación cross-tenant).
 *   - Sin company_id               → AdminUser.role_type (fallback de plataforma; poblado por
 *                                     scripts/backfillMongoRoles.js con el rol de mayor privilegio)
 *
 * Prerrequisito: validateJWT debe correr antes (setea req.uid).
 * El company_id (Mongo ObjectId) se lee de, en orden: req.params.company_id,
 * req.body.company_id, req.query.company_id, header x-company-id.
 *
 * Uso:
 *   router.patch('/update', validateJWT, authorizeMongoPermission('company','update'), handler)
 */
const authorizeMongoPermission = (resource, action) => async (req, res, next) => {
  try {
    if (!req.uid) {
      return res.status(401).json({ ok: false, msg: 'Unauthorized' });
    }

    const adminUser = await AdminUser.findById(req.uid)
      .select('role_type super_user active email');

    if (!adminUser || adminUser.active === false) {
      return res.status(403).json({ ok: false, msg: 'Forbidden' });
    }

    // Bypass global para super_user (plataforma entera)
    if (adminUser.super_user) {
      req.adminRoleType = adminUser.role_type ?? null;
      req.isSuperUser   = true;
      return next();
    }

    // company_id (Mongo ObjectId) como selector de contexto. Puede venir en el
    // header x-company-id (recomendado) o en params/body/query (compatibilidad).
    // Es solo un selector: el rol SIEMPRE se re-deriva del par (uid, compañía).
    const headerCompanyId =
      (typeof req.header === 'function' ? req.header('x-company-id') : undefined) ||
      req.headers?.['x-company-id'];

    const companyId = req.params?.company_id
      || req.body?.company_id
      || req.query?.company_id
      || headerCompanyId;

    let effectiveRoleType;
    let dbgCompanyFound = null; // TEMP DEBUG
    let dbgEmpMatched   = null; // TEMP DEBUG

    if (companyId) {
      // Contexto de compañía explícito: el rol DEBE salir de esa compañía.
      // El employee se identifica por userId (backfilled) o por email (`user`),
      // porque employees preexistentes no tienen userId. Ver scripts/backfillMongoRoles.js.
      const company = await Company.findOne(
        { _id: companyId },
        { employees: 1 },
      ).lean();

      const emp = company?.employees?.find(
        (e) =>
          (e.userId != null && String(e.userId) === String(req.uid)) ||
          (adminUser.email != null && e.user === adminUser.email),
      );

      dbgCompanyFound = !!company;                                   // TEMP DEBUG
      dbgEmpMatched   = emp ? { user: emp.user, roleType: emp.roleType, active: emp.active } : null; // TEMP DEBUG

      if (emp && emp.active !== false) {
        // Bypass a nivel de compañía
        if (emp.super_user) {
          req.adminRoleType = emp.roleType ?? null;
          req.isSuperUser   = true;
          return next();
        }
        effectiveRoleType = emp.roleType ?? null;
      } else {
        // Seguridad: no es miembro activo de la compañía indicada. NO se usa el
        // mirror global de AdminUser (evita escalación cross-tenant) → se deniega.
        effectiveRoleType = null;
      }
    } else {
      // Sin contexto de compañía: fallback global para endpoints de plataforma.
      effectiveRoleType = adminUser.role_type ?? null;
    }

    // ─── TEMP DEBUG (quitar tras diagnosticar el 403) ──────────────────────────
    console.log('[authzMongo][DEBUG]', {
      uid: String(req.uid),
      adminEmail: adminUser.email ?? null,
      adminRoleType: adminUser.role_type ?? null,
      companyIdRecibido: companyId ?? null,
      companyIdEn: {
        params: req.params?.company_id ?? null,
        body:   req.body?.company_id ?? null,
        query:  req.query?.company_id ?? null,
        header: headerCompanyId ?? null,
      },
      companyFound: dbgCompanyFound,
      empMatched:   dbgEmpMatched,
      effectiveRoleType,
      resource, action,
      permitido: hasPermission(effectiveRoleType, resource, action),
    });
    // ───────────────────────────────────────────────────────────────────────────

    if (!hasPermission(effectiveRoleType, resource, action)) {
      return res.status(403).json({ ok: false, msg: 'Forbidden: insufficient permissions' });
    }

    req.adminRoleType = effectiveRoleType;
    req.isSuperUser   = false;
    return next();

  } catch (err) {
    return res.status(500).json({ ok: false, msg: 'Authorization check failed' });
  }
};

module.exports = { authorizeMongoPermission };
