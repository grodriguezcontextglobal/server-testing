// scripts/migrate-staff-id.js
// Convierte company_staff.staff_id de MongoDB ObjectId (VARCHAR) → staff_member.id (INT)
// Correr con --dry-run primero para ver el plan antes de aplicar cambios.
//
// Uso:
//   node mysql/scripts/migrate-staff-id.js --dry-run
//   node mysql/scripts/migrate-staff-id.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') })
const { MongoClient } = require('mongodb')
const mysql = require('mysql2/promise')

// Regex para detectar MongoDB ObjectId (24 hex chars)
const MONGO_ID_RE = /^[0-9a-f]{24}$/i

/**
 * Lógica pura de resolución — sin conexiones DB.
 * Retorna el array de updates listos para aplicar.
 * Las filas sin mapeo se omiten silenciosamente (el caller puede detectarlas
 * comparando rows.length con el resultado).
 *
 * @param {Array<{id: string, staff_id: string}>} rows     - Filas de company_staff
 * @param {Map<string, string>}  mongoIdToEmail            - MongoDB ObjectId → email
 * @param {Map<string, number>}  emailToSqlId              - email → staff_member.id
 * @returns {{ updates: Array<{id, newStaffId}>, unmapped: Array<{id, staff_id, reason}> }}
 */
const INT_STR = /^\d+$/

function resolveStaffIdUpdates(rows, mongoIdToEmail, emailToSqlId) {
  const updates  = []
  const unmapped = []

  for (const row of rows) {
    const sid = String(row.staff_id ?? '')

    // Ya es un entero → saltar (migración parcial o ya correcto)
    if (INT_STR.test(sid)) continue

    let email

    if (MONGO_ID_RE.test(sid)) {
      // Caso A: MongoDB ObjectId → resolver vía mapa
      email = mongoIdToEmail.get(sid)
      if (!email) {
        unmapped.push({ id: row.id, staff_id: sid, reason: 'MongoDB ObjectId not found in AdminUser' })
        continue
      }
    } else if (sid.includes('@')) {
      // Caso B: email directamente almacenado como staff_id
      email = sid
    } else {
      unmapped.push({ id: row.id, staff_id: sid, reason: 'formato desconocido' })
      continue
    }

    const sqlId = emailToSqlId.get(email)
    if (sqlId === undefined) {
      unmapped.push({ id: row.id, staff_id: sid, reason: `email "${email}" not found in staff_member` })
      continue
    }

    updates.push({ id: row.id, newStaffId: sqlId })
  }

  // Exponer unmapped como propiedad del array para inspección en tests y caller
  updates.unmapped = unmapped
  return updates
}

// ─── Migración principal ──────────────────────────────────────────────────────

async function migrate(dryRun = true) {
  const sql = await mysql.createConnection({
    host:     process.env.PLANETSCALE_DATABASE_HOST,
    port:     parseInt(process.env.PLANETSCALE_DATABASE_PORT, 10) || 3306,
    user:     process.env.PLANETSCALE_DATABASE_USERNAME,
    password: process.env.PLANETSCALE_DATABASE_PASSWORD,
    database: process.env.PLANETSCALE_DATABASE_NAME,
    ssl:      { rejectUnauthorized: true },
  })

  // 1. Leer todas las filas de company_staff
  const [staffRows] = await sql.query('SELECT id, staff_id FROM company_staff')

  const intRows     = staffRows.filter(r => INT_STR.test(String(r.staff_id ?? '')))
  const emailRows   = staffRows.filter(r => String(r.staff_id ?? '').includes('@'))
  const mongoIdRows = staffRows.filter(r => MONGO_ID_RE.test(String(r.staff_id ?? '')))
  const otherRows   = staffRows.filter(r =>
    !INT_STR.test(String(r.staff_id ?? '')) &&
    !String(r.staff_id ?? '').includes('@') &&
    !MONGO_ID_RE.test(String(r.staff_id ?? ''))
  )

  console.log(`\nAudit company_staff.staff_id (total: ${staffRows.length})`)
  console.log(`  Enteros (ya migrados):  ${intRows.length}`)
  console.log(`  Emails directos:        ${emailRows.length}`)
  console.log(`  MongoDB ObjectIds:      ${mongoIdRows.length}`)
  console.log(`  Otros (desconocido):    ${otherRows.length}`)

  const toConvert = [...emailRows, ...mongoIdRows, ...otherRows]
  if (!toConvert.length) {
    console.log('\n✓ Todas las filas ya tienen staff_id INT. Nada que convertir.')
    await sql.end()
    return
  }

  // 2. Construir mongoIdToEmail solo si hay ObjectIds
  const mongoIdToEmail = new Map()
  if (mongoIdRows.length) {
    const mongo = await MongoClient.connect(process.env.DB_CNN)
    const db = mongo.db()
    const { ObjectId } = require('mongodb')
    const mongoIds   = [...new Set(mongoIdRows.map(r => r.staff_id))]
    const adminUsers = await db.collection('admin_users').find({
      _id: { $in: mongoIds.map(id => new ObjectId(id)) },
    }).project({ _id: 1, email: 1 }).toArray()
    adminUsers.forEach(u => mongoIdToEmail.set(u._id.toString(), u.email))
    await mongo.close()
  }

  // 3. Construir mapa email → staff_member.staff_id
  const emailsDirect = [...new Set(emailRows.map(r => String(r.staff_id)))]
  const emailsMongo  = [...mongoIdToEmail.values()]
  const allEmails    = [...new Set([...emailsDirect, ...emailsMongo])]

  let emailToSqlId = new Map()
  if (allEmails.length) {
    const [smRows] = await sql.query(
      `SELECT staff_id, email FROM staff_member WHERE email IN (${allEmails.map(() => '?').join(',')})`,
      allEmails
    )
    emailToSqlId = new Map(smRows.map(r => [r.email, r.staff_id]))
  }

  // 4. Resolver
  const updates  = resolveStaffIdUpdates(toConvert, mongoIdToEmail, emailToSqlId)
  const unmapped = updates.unmapped

  console.log(`\nPlan de actualización:`)
  console.log(`  UPDATEs a aplicar:         ${updates.length}`)
  console.log(`  Sin mapeo (DELETE o skip): ${unmapped.length}`)

  if (unmapped.length) {
    console.log('\n⚠  Filas sin mapeo en staff_member (se eliminarán):')
    console.table(unmapped)
  }

  if (updates.length) {
    console.log('\nPrimeras 5 filas del plan de UPDATE:')
    console.table(updates.slice(0, 5))
  }

  if (!dryRun) {
    for (const { id, newStaffId } of updates) {
      await sql.query('UPDATE company_staff SET staff_id = ? WHERE id = ?', [newStaffId, id])
    }
    if (unmapped.length) {
      const idsToDelete = unmapped.map(r => r.id)
      await sql.query(
        `DELETE FROM company_staff WHERE id IN (${idsToDelete.map(() => '?').join(',')})`,
        idsToDelete
      )
      console.log(`\n  Eliminadas ${idsToDelete.length} filas sin mapeo.`)
    }
    console.log('\n✓ Conversión de datos completada.')
    console.log('  Siguiente paso: ejecutar migrate_company_staff_staff_id_to_int.sql')
  } else {
    console.log('\n(dry run — no se escribió nada)')
  }

  await sql.end()
}

module.exports = { resolveStaffIdUpdates }

if (require.main === module) {
  migrate(process.argv.includes('--dry-run'))
    .catch(err => { console.error(err); process.exit(1) })
}
