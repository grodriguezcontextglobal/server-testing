// mysql/scripts/backfill-company-item-categories.js
// company_item_categories (read by POST /api/db_company/categories) has been
// empty for every company since it was introduced alongside the category-scoped
// roles feature (add_category_scoped_roles.sql) — nobody has ever called the
// POST /categories upsert to seed it. The actual category data lives as free
// text on item_inv.category_name. This backfills one catalog row per distinct
// (company_id, category_name) pair already present in item_inv, so the catalog
// reflects what companies are already using without requiring manual re-entry.
//
// Runs inside a transaction: with --dry-run it rolls back at the end so you can
// review the summary before writing anything.
//
// Uso:
//   node mysql/scripts/backfill-company-item-categories.js --dry-run
//   node mysql/scripts/backfill-company-item-categories.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') })
const mysql = require('mysql2/promise')

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
    `SELECT DISTINCT company_id, TRIM(category_name) AS category_name
     FROM item_inv
     WHERE category_name IS NOT NULL AND TRIM(category_name) != ''`
  )

  console.log(`\nPares (company_id, category_name) distintos encontrados en item_inv: ${rows.length}`)

  await connection.beginTransaction()

  let inserted = 0
  let alreadyPresent = 0

  try {
    for (const row of rows) {
      const [result] = await connection.execute(
        `INSERT IGNORE INTO company_item_categories (company_id, category_name, sub_category_name, active)
         VALUES (?, ?, NULL, 1)`,
        [row.company_id, row.category_name]
      )
      if (result.affectedRows > 0) inserted++
      else alreadyPresent++
    }

    const [[{ n: totalAfter }]] = [
      (await connection.query('SELECT COUNT(*) n FROM company_item_categories'))[0],
    ]

    console.log(`\nResumen:`)
    console.log(`  Insertadas:                 ${inserted}`)
    console.log(`  Ya existentes (sin cambio):  ${alreadyPresent}`)
    console.log(`  Filas totales en la tabla tras el run: ${totalAfter}`)

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

module.exports = { backfill }

if (require.main === module) {
  backfill(process.argv.includes('--dry-run')).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
