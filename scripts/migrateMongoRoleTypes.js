'use strict';

/**
 * Migración de roles MongoDB: Company.employees[].role (numérico) → roleType (canónico).
 *
 * La fuente de verdad del rol de un usuario ES Company.employees[].role,
 * no AdminUser.role (dato de registro inicial, sin relevancia operativa).
 *
 * Mapeo:
 *   "0" → root_admin
 *   "1" → admin
 *   "2" → sale_manager
 *   "3" → event_manager
 *   "4" → inventory_manager
 *   "5" → assistant
 *
 * Comportamiento:
 *   - Solo migra employees donde roleType es null/undefined (idempotente).
 *   - No sobreescribe roleType ya establecido.
 *
 * Uso: node scripts/migrateMongoRoleTypes.js
 */

const NUMERIC_ROLE_MAP = {
  '0': 'root_admin',
  '1': 'admin',
  '2': 'sale_manager',
  '3': 'event_manager',
  '4': 'inventory_manager',
  '5': 'assistant',
};

// ─── Funciones puras (exportadas para tests) ──────────────────────────────────

/**
 * Mapea un role numérico string ("0"-"5") al role_type canónico.
 * @param {string|null} role
 * @returns {string|null}
 */
function mapNumericRoleToRoleType(role) {
  if (role == null) return null;
  return NUMERIC_ROLE_MAP[String(role)] ?? null;
}

/**
 * Devuelve el path y valor para actualizar employees[index].roleType,
 * o null si no hay nada que migrar.
 * @param {{ role: string, roleType?: string|null }} employee
 * @param {number} index
 * @returns {{ path: string, value: string }|null}
 */
function buildEmployeeUpdate(employee, index) {
  if (employee.roleType !== null && employee.roleType !== undefined) return null;
  const mapped = mapNumericRoleToRoleType(employee.role);
  if (!mapped) return null;
  return { path: `employees.${index}.roleType`, value: mapped };
}

module.exports = { mapNumericRoleToRoleType, buildEmployeeUpdate };

// ─── Ejecución directa ────────────────────────────────────────────────────────
// Solo corre cuando se invoca directamente: node scripts/migrateMongoRoleTypes.js

if (require.main === module) {
  const mongoose = require('mongoose');

  const MONGO_URI = process.env.DB_CNN;
  if (!MONGO_URI) {
    console.error('ERROR: Variable de entorno DB_CNN no definida.');
    process.exit(1);
  }

  async function run() {
    await mongoose.connect(MONGO_URI);
    console.log('Conectado a MongoDB.');

    const Company = require('../models/Company');
    const companies = await Company.find({
      employees: {
        $elemMatch: {
          $or: [{ roleType: null }, { roleType: { $exists: false } }],
        },
      },
    }).lean();
    console.log(`[Company] Documentos con employees sin roleType: ${companies.length}`);

    let updated = 0;
    let skipped = 0;

    for (const company of companies) {
      const $set = {};

      for (let i = 0; i < company.employees.length; i++) {
        const empUpdate = buildEmployeeUpdate(company.employees[i], i);
        if (empUpdate) $set[empUpdate.path] = empUpdate.value;
      }

      if (Object.keys($set).length === 0) { skipped++; continue; }

      await Company.updateOne({ _id: company._id }, { $set });
      console.log(`  [OK] ${company.company_name ?? company._id} — ${Object.keys($set).length} employee(s) actualizados`);
      updated++;
    }

    console.log(`\nMigración completa. Actualizadas: ${updated} | Omitidas: ${skipped}`);
    await mongoose.disconnect();
  }

  run().catch(err => {
    console.error('Error durante la migración:', err);
    process.exit(1);
  });
}
