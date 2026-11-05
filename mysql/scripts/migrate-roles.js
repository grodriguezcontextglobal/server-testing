// scripts/migrate-roles.js
// Lee MongoDB → escribe en PlanetScale SQL
// Correr UNA vez, en branch de PS, con --dry-run primero
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true })
const { MongoClient } = require('mongodb')
const mysql = require('mysql2/promise')
const { randomUUID: uuid } = require('crypto')

// ─── Constantes de roles ──────────────────────────────────────────────────────

/**
 * Valores válidos de roleType (del refactor Phase 5).
 * Si un registro MongoDB tiene un valor de este set → confiar en él.
 */
const { VALID_ROLE_TYPES } = require('../constants/roles')

/**
 * Mapeo ORIGINAL de numericos MongoDB → roleType.
 * Aplica SOLO a registros SIN roleType válido (creados antes del refactor).
 * 
 * Importante: en el esquema VIEJO de MongoDB:
 *   0 = root_admin
 *   1 = admin  (algunos pueden ser sale_manager — ver lista de ambiguos)
 *   2 = manager ambiguo  → inferRoleType2()
 *   3 = assistant
 *   4 = assistant  (EVENT_STAFF fusionado)
 * 
 * NO confundir con el nuevo LEGACY_ROLE_MAP donde 2=sale_manager, 3=event_manager, etc.
 */
const OLD_ROLE_MAP = {
  '0': 'root_admin',
  '1': 'admin',          // revisar manualmente los que deberian ser sale_manager
  // '2' → inferRoleType2()
  '3': 'assistant',
  '4': 'assistant',      // EVENT_STAFF fusionado
}

/**
 * Heurístico para registros con OLD role=2 (Manager ambiguo).
 * Si tiene locations asignadas → era inventory_manager.
 * Si no tiene locations → era event_manager.
 */
function inferRoleType2(employee) {
  const hasLocations = (employee.preference?.managerLocation?.length ?? 0) > 0
  return hasLocations ? 'inventory_manager' : 'event_manager'
}

/**
 * Determina el roleType canónico de un empleado MongoDB.
 * Prioridad:
 *   1. emp.roleType si es válido (registro post-refactor) → confiar directamente
 *   2. role='2' sin roleType válido → inferRoleType2 (OLD role=2 era ambiguo)
 *   3. OLD_ROLE_MAP para roles 0,1,3,4 sin roleType
 *   4. 'assistant' como fallback seguro
 */
function resolveEmployeeRoleType(emp) {
  if (emp.roleType && VALID_ROLE_TYPES.has(emp.roleType)) return emp.roleType
  if (String(emp.role ?? '') === '2') return inferRoleType2(emp)
  return OLD_ROLE_MAP[String(emp.role ?? '')] ?? 'assistant'
}

// ─── Funciones puras (exportadas para tests) ──────────────────────────────────

/**
 * Construye el mapa email → staff_member.staff_id (INT) desde las filas SQL.
 * @param {Array<{staff_id: number, email: string}>} staffMemberRows
 * @returns {Record<string, number>}
 */
function buildStaffMemberMap(staffMemberRows) {
  return Object.fromEntries(staffMemberRows.map(r => [r.email, r.staff_id]))
}

/**
 * Construye los arrays de inserts para company_staff y staff_location_access.
 * @param {Array}  companies
 * @param {Record<string,number>} staffSqlIdByEmail  — email → staff_member.id INT
 * @param {Record<string,number>} roleIdByType
 * @param {Record<string,number>} sqlCompanyIdByName
 * @param {Record<string,number>} locationIdByName
 * @returns {{ staffInserts, locationInserts, skippedCompanies, skippedStaff, ambiguousRole1, ambiguousRole2 }}
 */
function buildStaffInserts(companies, staffSqlIdByEmail, roleIdByType, sqlCompanyIdByName, locationIdByName) {
  const staffInserts     = []
  const locationInserts  = []
  const skippedCompanies = []
  const skippedStaff     = []
  const ambiguousRole1   = []
  const ambiguousRole2   = []

  for (const company of companies) {
    const sqlCompanyId = sqlCompanyIdByName[company.company_name?.trim()]
    if (!sqlCompanyId) {
      skippedCompanies.push(company.company_name)
      continue
    }

    for (const emp of (company.employees ?? [])) {
      const staffId = staffSqlIdByEmail[emp.user]
      if (staffId === undefined) {
        skippedStaff.push({ email: emp.user, company: company.company_name, reason: 'not in staff_member' })
        continue
      }

      const roleType = resolveEmployeeRoleType(emp)

      if (!emp.roleType || !VALID_ROLE_TYPES.has(emp.roleType)) {
        const rawRole = String(emp.role ?? '')
        if (rawRole === '1') ambiguousRole1.push({ company: company.company_name, staff: emp.user, inferredAs: 'admin' })
        if (rawRole === '2' && (emp.preference?.managerLocation?.length ?? 0) === 0) {
          ambiguousRole2.push({ company: company.company_name, staff: emp.user, inferredAs: 'event_manager' })
        }
      }

      const companyStaffId = uuid()

      staffInserts.push({
        id:           companyStaffId,
        company_id:   sqlCompanyId,
        company_name: company.company_name ?? null,
        staff_id:     staffId,                      // INT de staff_member (no MongoDB ObjectId)
        role_id:      roleIdByType[roleType],
        is_active:    emp.active ?? true,
        assigned_by:  null,
      })

      for (const loc of (emp.preference?.managerLocation ?? [])) {
        const locationId = locationIdByName[loc.location] ?? null
        if (locationId === null) continue
        locationInserts.push({
          id:               uuid(),
          company_staff_id: companyStaffId,
          location_id:      locationId,
          can_create:       loc.actions?.create ?? false,
          can_update:       loc.actions?.update ?? false,
          can_delete:       loc.actions?.delete ?? false,
        })
      }
    }
  }

  return { staffInserts, locationInserts, skippedCompanies, skippedStaff, ambiguousRole1, ambiguousRole2 }
}

// ─── Migración principal ──────────────────────────────────────────────────────

async function migrate(dryRun = true) {
  const mongo = await MongoClient.connect(process.env.DB_CNN)
  const sql   = await mysql.createConnection({
    host:     process.env.PLANETSCALE_DATABASE_HOST,
    port:     parseInt(process.env.PLANETSCALE_DATABASE_PORT, 10) || 3306,
    user:     process.env.PLANETSCALE_DATABASE_USERNAME,
    password: process.env.PLANETSCALE_DATABASE_PASSWORD,
    database: process.env.PLANETSCALE_DATABASE_NAME,
    ssl:      { rejectUnauthorized: true },
  })
  const db = mongo.db()
  console.log(`\nConectado a MongoDB: "${db.databaseName}"`)
  const companiesCount = await db.collection('companies').countDocuments()
  console.log(`  Documentos en 'companies': ${companiesCount}`)

  const companies = await db.collection('companies').find({}).toArray()

  // roles SQL
  const [rolesRows] = await sql.query('SELECT id, role_type FROM roles')
  const roleIdByType = Object.fromEntries(rolesRows.map(r => [r.role_type, r.id]))

  // company_info SQL: company_name → company_id (INT)
  const [companyInfoRows] = await sql.query('SELECT company_id, company_name FROM company_info')
  const sqlCompanyIdByName = Object.fromEntries(companyInfoRows.map(c => [c.company_name.trim(), c.company_id]))
  console.log(`  Empresas en company_info SQL: ${companyInfoRows.length}`)

  // staff_member SQL: email → id (INT) — fuente canónica para staff_id
  const [smRows] = await sql.query('SELECT staff_id, email FROM staff_member')
  const staffSqlIdByEmail = buildStaffMemberMap(smRows)
  console.log(`  Staff en staff_member SQL:    ${smRows.length}`)

  // locations SQL
  const [sqlLocRows] = await sql.query('SELECT location_id, location_name FROM locations')
  const locationIdByName = Object.fromEntries(sqlLocRows.map(l => [l.location_name, l.location_id]))

  const { staffInserts, locationInserts, skippedCompanies, skippedStaff, ambiguousRole1, ambiguousRole2 } =
    buildStaffInserts(companies, staffSqlIdByEmail, roleIdByType, sqlCompanyIdByName, locationIdByName)

  console.log(`\nResumen:`)
  console.log(`  Staff a migrar:                ${staffInserts.length}`)
  console.log(`  Location access a migrar:      ${locationInserts.length}`)
  console.log(`  Staff sin match SQL (skip):    ${skippedStaff.length}  ← no están en staff_member`)
  console.log(`  Ambiguos role=1 (admin?):      ${ambiguousRole1.length}  ← revisar si son sale_manager`)
  console.log(`  Ambiguos role=2 sin loc:       ${ambiguousRole2.length}  ← inferidos como event_manager`)
  console.log(`  Empresas sin match en SQL:     ${skippedCompanies.length}  ← no están en company_info`)

  if (skippedCompanies.length) {
    console.log('\n⚠  MongoDB companies SIN match en company_info SQL:')
    skippedCompanies.forEach(n => console.log(`     - "${n}"`))
  }
  if (skippedStaff.length) {
    console.log('\n⚠  Staff sin match en staff_member SQL:')
    console.table(skippedStaff)
  }
  if (ambiguousRole1.length) {
    console.log('\n⚠  Role=1 sin roleType (inferidos como admin):')
    console.table(ambiguousRole1)
  }
  if (ambiguousRole2.length) {
    console.log('\n⚠  Role=2 sin locations (inferidos como event_manager):')
    console.table(ambiguousRole2)
  }

  if (!dryRun) {
    for (const row of staffInserts) {
      await sql.query(
        'INSERT IGNORE INTO company_staff (id,company_id,company_name,staff_id,role_id,is_active,assigned_by) VALUES (?,?,?,?,?,?,?)',
        [row.id, row.company_id, row.company_name, row.staff_id, row.role_id, row.is_active, row.assigned_by]
      )
    }
    for (const row of locationInserts) {
      await sql.query(
        'INSERT IGNORE INTO staff_location_access (id,company_staff_id,location_id,can_create,can_update,can_delete) VALUES (?,?,?,?,?,?)',
        [row.id, row.company_staff_id, row.location_id, row.can_create, row.can_update, row.can_delete]
      )
    }
    console.log('\n✓ Migración completada.')
  } else {
    console.log('\n(dry run — no se escribió nada en SQL)')
  }

  await mongo.close()
  await sql.end()
}

module.exports = { buildStaffMemberMap, buildStaffInserts, resolveEmployeeRoleType }

if (require.main === module) {
  migrate(process.argv.includes('--dry-run'))
    .catch(err => { console.error(err); process.exit(1) })
}