'use strict';

/**
 * La compañía (Mongo ObjectId) que viene en el body tiene que ser una de la
 * que quien llama es empleado activo (AC-3; 2026-11-04).
 *
 * Para rutas que escriben con `company` del body y no pasan por un permiso del
 * catálogo, como /api/receiver/receivers-pool-bulk: antes cualquier sesión
 * escribía en el pool de cualquier compañía.
 *
 *   - Si viene x-company-id y no coincide con la del body: 403.
 *   - super_user de plataforma: pasa (mismo criterio que authorizeMongoPermission).
 *   - Sin membresía activa (helpers/companyMembership.js): 403.
 *
 * Va después de validateJWT (usa request.uid).
 */

function requireBodyCompanyMembership(field = 'company', {
  AdminUser = () => require('../models/AdminUser'),
  findCompanyMembership = (...a) => require('../helpers/companyMembership').findCompanyMembership(...a),
} = {}) {
  return async function requireBodyCompanyMembershipMw(request, response, next) {
    try {
      const companyId = request.body?.[field];
      if (!companyId || typeof companyId !== 'string') {
        return response.status(400).json({ ok: false, msg: `${field} is required` });
      }
      const header = request.headers?.['x-company-id'];
      if (header && String(header) !== companyId) {
        return response.status(403).json({ ok: false, msg: 'Forbidden: company does not match the company context' });
      }
      const adminUser = await AdminUser().findById(request.uid).select('email super_user').lean();
      if (!adminUser) return response.status(401).json({ ok: false, msg: 'Unauthorized' });
      if (adminUser.super_user) return next();
      const membership = await findCompanyMembership(companyId, { id: request.uid, email: adminUser.email });
      if (!membership) {
        return response.status(403).json({ ok: false, msg: 'Forbidden: not a member of this company' });
      }
      return next();
    } catch (error) {
      return response.status(500).json({ ok: false, msg: 'Authorization check failed' });
    }
  };
}

module.exports = { requireBodyCompanyMembership };
