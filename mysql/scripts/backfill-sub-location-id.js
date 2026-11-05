// mysql/scripts/backfill-sub-location-id.js
// Fase 4a: backfillea item_inv.sub_location_id resolviendo/creando la cadena
// jerárquica en sub_locations a partir del JSON legacy item_inv.sub_location.
// Requiere que mysql/migrations/add_sub_location_id_to_item_inv.sql ya haya
// corrido (agrega la columna + índice).
//
// Corre TODO dentro de una transacción: en --dry-run se hace rollback al final,
// así que se ejecuta la lógica real de find-or-create (necesaria para resolver
// bien los nodos compartidos entre filas) sin dejar ningún cambio permanente.
//
// Uso:
//   node mysql/scripts/backfill-sub-location-id.js --dry-run
//   node mysql/scripts/backfill-sub-location-id.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true })
const mysql = require('mysql2/promise')
const { processSubLocationPath } = require('../controllers/sub_location')

/**
 * Normaliza item_inv.sub_location (JSON array, JSON string, string simple,
 * o null/undefined) a un array de segmentos de path. Pura, sin DB.
 */
function parseSubLocationSegments(raw) {
  if (raw === null || raw === undefined) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  if (raw === '' || raw === 'null') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [raw]
  } catch (e) {
    return [raw]
  }
}

async function backfill(dryRun = true) {
  const connection = await mysql.createConnection({
    host: process.env.PLANETSCALE_DATABASE_HOST,
    port: parseInt(process.env.PLANETSCALE_DATABASE_PORT, 10) || 3306,
    user: process.env.PLANETSCALE_DATABASE_USERNAME,
    password: process.env.PLANETSCALE_DATABASE_PASSWORD,
    database: process.env.PLANETSCALE_DATABASE_NAME,
    ssl: { rejectUnauthorized: true },
  })

  const [rows] = await connection.query(
    `SELECT item_id, location_id, company_id, sub_location
     FROM item_inv
     WHERE sub_location_id IS NULL
       AND location_id IS NOT NULL
       AND sub_location IS NOT NULL
       AND sub_location != '' AND sub_location != 'null'`
  )

  console.log(`\nCandidatos a backfillear: ${rows.length}`)

  await connection.beginTransaction()

  let resolved = 0
  let skipped = 0
  let errors = 0
  const skippedSamples = []

  try {
    for (const row of rows) {
      try {
        const segments = parseSubLocationSegments(row.sub_location)
        const leafId = await processSubLocationPath(
          connection,
          row.location_id,
          segments,
          row.company_id
        )

        if (leafId === null) {
          skipped++
          if (skippedSamples.length < 10) {
            skippedSamples.push({ item_id: row.item_id, sub_location: row.sub_location })
          }
          continue
        }

        await connection.execute(
          'UPDATE item_inv SET sub_location_id = ? WHERE item_id = ?',
          [leafId, row.item_id]
        )
        resolved++
      } catch (rowError) {
        errors++
        console.error(`  item_id=${row.item_id}: ${rowError.message}`)
      }
    }

    const [[{ n: subLocationCount }]] = [
      (await connection.query('SELECT COUNT(*) n FROM sub_locations'))[0],
    ]

    console.log(`\nResumen:`)
    console.log(`  Resueltos (sub_location_id seteado):                ${resolved}`)
    console.log(`  Sin resolver (path vacío/null, ej. [null,null,null]): ${skipped}`)
    console.log(`  Errores:                                            ${errors}`)
    console.log(`  Filas en sub_locations tras el run:                 ${subLocationCount}`)

    if (skippedSamples.length) {
      console.log(`\n  Muestra de items sin resolver:`)
      console.table(skippedSamples)
    }

    if (dryRun) {
      await connection.rollback()
      console.log('\n(dry run — se revirtió todo, no se escribió nada)')
    } else {
      await connection.commit()
      console.log('\n✓ Backfill completado.')
    }
  } catch (fatalError) {
    await connection.rollback()
    throw fatalError
  }

  await connection.end()
}

module.exports = { parseSubLocationSegments }

if (require.main === module) {
  backfill(process.argv.includes('--dry-run')).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
