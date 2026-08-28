'use strict';

/**
 * Auditoría de consistencia de roles: MongoDB (fuente de verdad) vs MySQL.
 *
 *   node scripts/audit-role-consistency.js            # solo reporta
 *   node scripts/audit-role-consistency.js --apply    # además corrige MySQL
 *
 * Por qué existe: hay DOS representaciones del rol de un empleado y ninguna
 * herramienta las compara.
 *
 *   - Mongo `company.employees[]` -> { roleType, role, active }. Es lo que el
 *     frontend pinta (con `company.roleLabels`) y, por decisión del 2026-08-28,
 *     LA FUENTE DE VERDAD.
 *   - MySQL `company_staff` -> { role_id, is_active }, resuelto contra `roles`.
 *     Es lo que el backend APLICA: getStaffCompanyAccess (mysql/helpers/
 *     staffAccess.js) cuelga de acá todo el scope de inventario.
 *
 * Nada garantiza que se muevan juntas: company_staff se escribe desde
 * controller/company.js, mysql/controllers/staff.js y los scripts de migración,
 * cada uno por su lado. La divergencia es silenciosa y de las peores: la UI
 * muestra un rol y el servidor aplica otro.
 *
 * NOTA SOBRE `status` vs `active`: el campo que corresponde a `is_active` es
 * `active` (booleano), NO `status` ('Confirmed'/'Pending', que describe la
 * invitación). Compararlos al revés hace que un empleado dado de baja
 * correctamente parezca un error.
 *
 * Salida: exit 0 si todo concuerda, exit 1 si hay divergencias — para poder
 * colgarlo de un cron o de CI.
 */

require('dotenv').config();
const { dbConnection } = require('../database/config');
const Company = require('../models/Company');
const getConnection = require('../mysql/database/config');

const APPLY = process.argv.includes('--apply');
const norm = (v) => String(v ?? '').trim().toLowerCase();

async function main() {
  await dbConnection();
  const sql = getConnection();

  const [roles] = await sql.execute('SELECT id, role_type, role_level FROM roles');
  const roleById = new Map(roles.map((r) => [Number(r.id), r]));
  const roleIdByType = new Map(roles.map((r) => [r.role_type, Number(r.id)]));
  const roleIdByLevel = new Map(roles.map((r) => [Number(r.role_level), Number(r.id)]));

  const [staffRows] = await sql.execute('SELECT staff_id, LOWER(email) email FROM staff_member');
  const staffIdByEmail = new Map(staffRows.map((r) => [r.email, Number(r.staff_id)]));

  const [csRows] = await sql.execute(
    'SELECT id, company_id, staff_id, role_id, is_active FROM company_staff'
  );
  const membership = new Map(csRows.map((r) => [`${r.company_id}|${r.staff_id}`, r]));

  const [companyRows] = await sql.execute('SELECT company_id, company_name FROM company_info');
  const sqlCompanyIds = new Map();
  for (const r of companyRows) {
    const key = norm(r.company_name);
    if (!sqlCompanyIds.has(key)) sqlCompanyIds.set(key, []);
    sqlCompanyIds.get(key).push(Number(r.company_id));
  }

  const companies = await Company.find({}, { company_name: 1, employees: 1 }).lean();

  const findings = {
    roleMismatch: [],      // Mongo y SQL dicen roles distintos
    activeMismatch: [],    // Mongo y SQL discrepan en si está de baja
    noMembership: [],      // hay staff_member pero no fila en company_staff
    noStaffMember: [],     // el email no existe en staff_member
    mongoSelfConflict: [], // el propio Mongo se contradice: role vs roleType
    ambiguousCompany: [],  // el nombre de company matchea más de un company_id
    // ─── Informativo, NO es divergencia ───────────────────────────────────────
    // Empleado en la lista de Mongo sin `userId`: la invitación no se aceptó y
    // la cuenta nunca se creó. Es un estado legítimo del flujo de alta, no un
    // error de sincronización, así que no cuenta para el exit code — si contara,
    // el cron gritaría todos los días por invitaciones que están esperando y la
    // gente aprendería a ignorarlo.
    //
    // OJO al leer estas filas: `active` y `status` de Mongo NO son confiables
    // acá. Los cinco casos observados el 2026-08-28 venían con active:true y
    // status:'Confirmed' aunque ninguno tenía cuenta. La ausencia de `userId`
    // es la única señal fiable de que la cuenta no existe.
    pendingInvitation: [],
  };
  let ok = 0;
  let evaluated = 0;

  for (const company of companies) {
    const candidates = sqlCompanyIds.get(norm(company.company_name)) || [];
    if (candidates.length > 1) {
      findings.ambiguousCompany.push({ company: company.company_name, company_ids: candidates });
    }
    const companyId = candidates[0];

    for (const emp of company.employees || []) {
      if (!emp?.user) continue;
      evaluated += 1;
      const base = { company: company.company_name, company_id: companyId, email: emp.user };

      // El propio Mongo puede contradecirse entre el nivel numérico y el nombre.
      const levelFromType = roleIdByType.has(emp.roleType)
        ? roleById.get(roleIdByType.get(emp.roleType)).role_level
        : null;
      if (emp.role !== undefined && levelFromType !== null && Number(emp.role) !== levelFromType) {
        findings.mongoSelfConflict.push({
          ...base, mongo_role: emp.role, mongo_roleType: emp.roleType, level_esperado: levelFromType,
        });
      }

      if (!emp.userId) {
        findings.pendingInvitation.push({ ...base, mongo: emp.roleType });
        continue;
      }
      if (!companyId) continue;

      const staffId = staffIdByEmail.get(norm(emp.user));
      if (!staffId) {
        findings.noStaffMember.push({ ...base, mongo: emp.roleType, active: emp.active });
        continue;
      }

      const row = membership.get(`${companyId}|${staffId}`);
      if (!row) {
        findings.noMembership.push({ ...base, staff_id: staffId, mongo: emp.roleType, active: emp.active });
        continue;
      }

      const sqlRole = roleById.get(Number(row.role_id));
      const wantRoleId =
        roleIdByType.get(emp.roleType) ??
        (emp.role !== undefined ? roleIdByLevel.get(Number(emp.role)) : undefined);

      let clean = true;
      if (wantRoleId !== undefined && Number(row.role_id) !== wantRoleId) {
        clean = false;
        findings.roleMismatch.push({
          ...base, staff_id: staffId,
          mongo: emp.roleType, mongo_role: emp.role,
          sql: sqlRole?.role_type, sql_role_id: Number(row.role_id),
          fix_role_id: wantRoleId,
        });
      }
      const wantActive = emp.active === false ? 0 : 1;
      if (Number(row.is_active) !== wantActive) {
        clean = false;
        findings.activeMismatch.push({
          ...base, staff_id: staffId,
          mongo_active: emp.active, sql_is_active: Number(row.is_active), fix_is_active: wantActive,
        });
      }
      if (clean) ok += 1;
    }
  }

  // ─── Reporte ───────────────────────────────────────────────────────────────
  const counts = Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length]));
  console.log('=== Auditoría de roles: Mongo (verdad) vs MySQL company_staff ===');
  console.log(`companies: ${companies.length} | empleados evaluados: ${evaluated} | consistentes: ${ok}`);
  console.log(counts);

  const LABEL = {
    roleMismatch: 'ROL DISTINTO — el backend aplica un rol que Mongo no dice',
    activeMismatch: 'BAJA DESALINEADA — uno de los dos lados lo tiene activo y el otro no',
    noMembership: 'SIN FILA EN company_staff — 403 en todo endpoint de inventario con scope',
    noStaffMember: 'SIN staff_member — el email nunca llegó a SQL',
    pendingInvitation: 'INVITACION PENDIENTE — sin userId en Mongo, la cuenta no existe (esperado, informativo)',
    mongoSelfConflict: 'MONGO SE CONTRADICE — role (nivel) y roleType no coinciden',
    ambiguousCompany: 'NOMBRE DE COMPANY AMBIGUO — matchea más de un company_id',
  };
  for (const [key, rows] of Object.entries(findings)) {
    if (!rows.length) continue;
    console.log(`\n--- ${LABEL[key]} (${rows.length}) ---`);
    for (const r of rows) console.log(' ', JSON.stringify(r));
  }

  // ─── Remediación ───────────────────────────────────────────────────────────
  const fixes = [
    ...findings.roleMismatch.map((r) => ({
      sql: 'UPDATE company_staff SET role_id = ? WHERE company_id = ? AND staff_id = ?',
      args: [r.fix_role_id, r.company_id, r.staff_id],
      why: `${r.email} @ ${r.company}: ${r.sql} -> ${r.mongo}`,
    })),
    ...findings.activeMismatch.map((r) => ({
      sql: 'UPDATE company_staff SET is_active = ? WHERE company_id = ? AND staff_id = ?',
      args: [r.fix_is_active, r.company_id, r.staff_id],
      why: `${r.email} @ ${r.company}: is_active ${r.sql_is_active} -> ${r.fix_is_active}`,
    })),
  ];

  if (fixes.length) {
    console.log(`\n=== Remediación (${fixes.length} UPDATE${fixes.length > 1 ? 's' : ''}) ===`);
    for (const f of fixes) console.log(`  ${f.why}\n    ${f.sql}  -- ${JSON.stringify(f.args)}`);
    if (APPLY) {
      console.log('\n--apply: ejecutando...');
      for (const f of fixes) {
        const [res] = await sql.execute(f.sql, f.args);
        console.log(`  ok (${res.affectedRows} fila) ${f.why}`);
      }
      console.log('Listo. Volver a correr sin --apply para confirmar que quedó limpio.');
    } else {
      console.log('\n(solo reporte — correr con --apply para ejecutarlos)');
    }
  }

  // Lo que este script NO puede arreglar solo: falta crear el usuario/staff.
  const manual = findings.noStaffMember.length + findings.noMembership.length;
  if (manual) {
    console.log(`\n=== Requiere alta manual (${manual}) ===`);
    console.log('  Sin staff_member o sin membresía activa: hay que provisionar al usuario,');
    console.log('  no alcanza un UPDATE. Mientras no exista, esas personas reciben 403 en inventario.');
  }

  const drift = fixes.length + manual + findings.mongoSelfConflict.length;
  process.exit(drift > 0 && !APPLY ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
