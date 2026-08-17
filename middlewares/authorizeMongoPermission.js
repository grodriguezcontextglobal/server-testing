'use strict';

const AdminUser         = require('../models/AdminUser');
const Company           = require('../models/Company');
const { hasPermission } = require('../constants/rolePermissions');
const { resolveCompanyContext } = require('../helpers/companyContext');

/**
 * Middleware de autorización para rutas MongoDB.
 *
 * FUENTE DE VERDAD DEL ROL: Company.employees. El rol es SIEMPRE por-compañía —
 * un usuario puede pertenecer a varias compañías con distintos roles. El campo
 * AdminUser.role_type NO participa en la autorización.
 *
 *   - super_user (flag de plataforma en AdminUser) → bypass total.
 *   - Con company_id → se busca al employee (match por userId o email) en esa
 *     compañía y se usa su roleType. Si no eres miembro activo → 403.
 *   - Sin company_id → no hay contexto de compañía → sin rol → 403 (salvo super_user).
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
      .select('super_user active email');

    if (!adminUser || adminUser.active === false) {
      return res.status(403).json({ ok: false, msg: 'Forbidden' });
    }

    // Bypass global para super_user (flag de plataforma, no un rol)
    if (adminUser.super_user) {
      req.adminRoleType = null;
      req.isSuperUser   = true;
      return next();
    }

    // company_id (Mongo ObjectId) como selector de contexto. Puede venir en el
    // header x-company-id (recomendado) o en params/body/query (compatibilidad).
    // Mismo criterio que usan los call-sites de auditoría — ver helpers/companyContext.js.
    const companyId = resolveCompanyContext(req);

    // El rol SIEMPRE viene de Company.employees. Sin contexto de compañía o sin
    // membresía activa → sin rol → se deniega (no hay fallback a AdminUser.role_type).
    let effectiveRoleType = null;

    if (companyId) {
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

      if (emp && emp.active !== false) {
        // Bypass a nivel de compañía
        if (emp.super_user) {
          req.adminRoleType = emp.roleType ?? null;
          req.isSuperUser   = true;
          return next();
        }
        effectiveRoleType = emp.roleType ?? null;
      }
      // Si no matchea o está inactivo → effectiveRoleType queda null → 403.
    }

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
