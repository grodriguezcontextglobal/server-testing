'use strict';

/**
 * Backfill de identidad en MongoDB para la autorización
 * (middlewares/authorizeMongoPermission.js).
 *
 * FUENTE DE VERDAD DEL ROL: Company.employees[].roleType (por-compañía).
 * AdminUser.role_type NO participa en la autorización.
 *
 * Este script hace dos cosas:
 *
 *   1) Backfill de Company.employees[].userId (link al AdminUser por email).
 *      Los employees preexistentes solo tienen `user` (email); el middleware
 *      matchea por email o userId, pero backfilleamos userId para queries
 *      correctas y baratas. Incluye employees inactivos a propósito: si la
 *      empresa los reactiva luego, no se rompe el flujo.
 *
 *   2) Reset de AdminUser.role_type → null. Quedó con valores de un enfoque
 *      previo (mirror global); como ya no se usa para autorizar, se limpia para
 *      no inducir a error. El rol se resuelve siempre desde Company.employees.
 *
 * Idempotente. Uso: node scripts/backfillMongoRoles.js
 */

// ─── Funciones puras (exportadas para tests) ──────────────────────────────────

/**
 * Devuelve { path, value } para setear employees[index].userId, o null.
 * @param {{ user?: string, userId?: any }} employee
 * @param {number} index
 * @param {Record<string, any>} adminIdByEmail  email → AdminUser _id
 */
function buildUserIdBackfill(employee, index, adminIdByEmail) {
  if (employee.userId != null) return null;
  const id = employee.user ? adminIdByEmail[employee.user] : undefined;
  if (id == null) return null;
  return { path: `employees.${index}.userId`, value: id };
}

module.exports = { buildUserIdBackfill };

// ─── Ejecución directa ──────────────────────────────────────────────────────

if (require.main === module) {
  require('dotenv').config(); // carga .env igual que index.js
  const mongoose = require('mongoose');

  const MONGO_URI = process.env.DB_CNN;
  if (!MONGO_URI) {
    console.error('ERROR: Variable de entorno DB_CNN no definida.');
    process.exit(1);
  }

  async function run() {
    await mongoose.connect(MONGO_URI);
    console.log('Conectado a MongoDB.');

    const AdminUser = require('../models/AdminUser');
    const Company   = require('../models/Company');

    // Mapa email → AdminUser _id
    const admins = await AdminUser.find({}, { email: 1 }).lean();
    const adminIdByEmail = {};
    for (const a of admins) if (a.email) adminIdByEmail[a.email] = a._id;

    const companies = await Company.find({}, { company_name: 1, employees: 1 }).lean();

    // 1) Backfill de userId en Company.employees
    let employeesUpdated = 0;
    for (const company of companies) {
      const $set = {};
      (company.employees ?? []).forEach((emp, i) => {
        const upd = buildUserIdBackfill(emp, i, adminIdByEmail);
        if (upd) $set[upd.path] = upd.value;
      });
      if (Object.keys($set).length) {
        await Company.updateOne({ _id: company._id }, { $set });
        employeesUpdated += Object.keys($set).length;
        console.log(`  [userId] ${company.company_name ?? company._id} — ${Object.keys($set).length} employee(s)`);
      }
    }

    // 2) Reset de AdminUser.role_type (deprecado para autorización)
    const resetRes = await AdminUser.updateMany(
      { role_type: { $ne: null } },
      { $set: { role_type: null } },
    );
    const resetCount = resetRes.modifiedCount ?? resetRes.nModified ?? 0;

    console.log(`\nBackfill completo. userId seteados: ${employeesUpdated} | AdminUser.role_type reseteados a null: ${resetCount}`);
    await mongoose.disconnect();
  }

  run().catch((err) => {
    console.error('Error durante el backfill:', err);
    process.exit(1);
  });
}
