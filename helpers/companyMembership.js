'use strict';

const { isValidObjectId } = require('mongoose');
const Company = require('../models/Company');

/**
 * Busca la membresía activa de un AdminUser en una compañía.
 *
 * Mismo criterio que authorizeMongoPermission: la fuente de verdad es
 * Company.employees, y el employee se identifica por userId o, en los
 * preexistentes sin userId, por email (`user`). Se extrajo aquí porque las
 * comprobaciones de "¿este usuario pertenece a esta compañía?" que no pasan por
 * un permiso del catálogo (documentos, perfil, force-logout) necesitan
 * exactamente el mismo match.
 *
 * @param {string} companyId  Mongo ObjectId de la compañía.
 * @param {{ id?: string, _id?: unknown, email?: string }} adminUser
 * @returns {Promise<object|null>} el employee activo, o null.
 */
async function findCompanyMembership(companyId, adminUser) {
  if (!companyId || !adminUser) return null;
  // Un id de compañía mal formado no es "error del servidor": simplemente no
  // hay membresía. Sin esto, findOne lanza CastError y acaba en 500.
  if (!isValidObjectId(companyId)) return null;
  const uid = String(adminUser.id ?? adminUser._id ?? '');

  const company = await Company.findOne({ _id: companyId }, { employees: 1 }).lean();
  const emp = company?.employees?.find(
    (e) =>
      (e.userId != null && uid && String(e.userId) === uid) ||
      (adminUser.email != null && e.user === adminUser.email),
  );
  return emp && emp.active !== false ? emp : null;
}

module.exports = { findCompanyMembership };
