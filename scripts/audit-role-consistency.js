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

// Los require pesados (dotenv, mongoose, el pool de MySQL) viven DENTRO de
// main(): requerir este módulo desde un test tiene que dar las funciones puras
// sin abrir una conexión ni cargar un modelo. Arriba, el solo `require` del
// script costaba ~30s en la suite.

const APPLY = process.argv.includes('--apply');
const norm = (v) => String(v ?? '').trim().toLowerCase();

// ─── Lógica pura (sin DB) — exportada al final para poder testearla ──────────

/** Hallazgos que `--apply` sí sabe arreglar con un UPDATE. */
const FIXABLE_BY_APPLY = ['roleMismatch', 'activeMismatch'];

/** Hallazgos que necesitan a una persona: ningún UPDATE los resuelve. */
const NEEDS_HUMAN = [
  'noStaffMember',
  'noMembership',
  'mongoSelfConflict',
  'ambiguousCompany',
  'unmatchedCompany',
];

/**
 * Decide si una compañía de Mongo se puede auditar, según cuántos `company_id`
 * de SQL matchean su nombre.
 *
 * El matcheo es POR NOMBRE, que es inherentemente frágil, así que la respuesta
 * tiene que ser explícita en los tres casos:
 *   - exactamente 1  → auditable contra ese id.
 *   - más de 1       → AMBIGUO. Antes se registraba el hallazgo y se seguía
 *                      igual con `candidates[0]`, así que los UPDATE de
 *                      `--apply` podían caer en la compañía EQUIVOCADA.
 *   - 0              → SIN CORRESPONDENCIA. Antes sus empleados se descartaban
 *                      con un `continue` mudo: no aparecían ni en `ok` ni en
 *                      ningún hallazgo. En una herramienta de auditoría el
 *                      silencio se lee como éxito.
 */
function resolveCompanyMatch(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 1) return { auditable: true, companyId: list[0], company_ids: list };
  if (list.length > 1) return { auditable: false, reason: 'ambiguous', company_ids: list };
  return { auditable: false, reason: 'unmatched', company_ids: [] };
}

/**
 * `is_active` que SQL debería tener según Mongo, o `null` si Mongo no opina.
 *
 * `active` ausente NO significa "activo": significa que el dato no está. La
 * versión anterior (`emp.active === false ? 0 : 1`) lo asumía activo, así que
 * `--apply` podía REACTIVAR en SQL a alguien correctamente dado de baja. Con
 * `null` no se compara ni se propone ningún UPDATE.
 */
function resolveDesiredActive(emp) {
  if (typeof emp?.active !== 'boolean') return null;
  return emp.active ? 1 : 0;
}

/**
 * Exit code del script. `--apply` arregla los de FIXABLE_BY_APPLY, pero todo lo
 * demás sigue ahí después de aplicar y necesita intervención manual.
 *
 * Antes con `--apply` el exit era SIEMPRE 0, así que un cron que corriera con
 * esa bandera nunca reportaba justamente lo que el script no puede arreglar
 * solo.
 */
function computeExitCode(findings, { apply = false } = {}) {
  const count = (keys) => keys.reduce((n, key) => n + (findings?.[key]?.length || 0), 0);
  const pending = count(NEEDS_HUMAN) + (apply ? 0 : count(FIXABLE_BY_APPLY));
  return pending > 0 ? 1 : 0;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const { dbConnection } = require('../database/config');
  const Company = require('../models/Company');
  const getConnection = require('../mysql/database/config');

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
    unmatchedCompany: [],  // el nombre de company no matchea ninguno en SQL
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
    const match = resolveCompanyMatch(sqlCompanyIds.get(norm(company.company_name)));
    const employees = (company.employees || []).filter((emp) => emp?.user);

    // Una compañía que no se puede resolver a UN company_id se reporta a nivel
    // compañía, con cuántos empleados quedaron sin auditar. Reportar cada
    // empleado por separado inundaría la salida; no reportar nada los hacía
    // desaparecer.
    if (!match.auditable) {
      const bucket = match.reason === 'ambiguous' ? 'ambiguousCompany' : 'unmatchedCompany';
      findings[bucket].push({
        company: company.company_name,
        company_ids: match.company_ids,
        empleados_sin_auditar: employees.length,
      });
    }

    const companyId = match.companyId;

    for (const emp of employees) {
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
      // La compañía ya se reportó arriba; comparar contra un company_id
      // arbitrario produciría hallazgos falsos y, con --apply, UPDATEs en la
      // compañía equivocada.
      if (!match.auditable) continue;

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
      // `null` = Mongo no dice nada sobre la baja. No se compara ni se propone
      // UPDATE: asumir "activo" reactivaría a quien esté correctamente de baja.
      const wantActive = resolveDesiredActive(emp);
      if (wantActive !== null && Number(row.is_active) !== wantActive) {
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
    ambiguousCompany: 'NOMBRE DE COMPANY AMBIGUO — matchea más de un company_id; sus empleados NO se auditaron',
    unmatchedCompany: 'COMPANY SIN CORRESPONDENCIA EN SQL — sus empleados NO se auditaron',
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

  // Lo que este script NO puede arreglar solo. Sigue pendiente DESPUÉS de
  // --apply, así que es lo que decide el exit code en ese modo.
  const manual = NEEDS_HUMAN.reduce((n, key) => n + findings[key].length, 0);
  if (manual) {
    console.log(`\n=== Requiere intervención manual (${manual}) ===`);
    console.log('  Sin staff_member o sin membresía activa: hay que provisionar al usuario,');
    console.log('  no alcanza un UPDATE. Mientras no exista, esas personas reciben 403 en inventario.');
    console.log('  Company ambigua o sin correspondencia: hay que resolver el nombre contra');
    console.log('  company_info; hasta entonces esos empleados quedan SIN auditar.');
    console.log('  Mongo contradictorio: hay que corregir el dato en Mongo, que es la fuente.');
  }

  process.exit(computeExitCode(findings, { apply: APPLY }));
}

// Solo corre cuando se invoca como script. Al requerirlo desde un test se
// obtienen las funciones puras sin abrir conexiones — mismo patrón que
// scripts/migrateMongoRoleTypes.js.
if (require.main === module) {
  main().catch((error) => {
    console.error('ERROR:', error.message);
    process.exit(1);
  });
}

module.exports = {
  FIXABLE_BY_APPLY,
  NEEDS_HUMAN,
  resolveCompanyMatch,
  resolveDesiredActive,
  computeExitCode,
};
