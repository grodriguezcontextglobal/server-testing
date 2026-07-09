require('dotenv').config();
const getConnection = require('../database/config');

async function seed() {
  const pool = getConnection();

  try {
    // Step 1: Seed locations
    console.log('Step 1: Seeding locations from item_inv...');
    const [locResult] = await pool.query(`
      INSERT IGNORE INTO locations (company_id, location_name)
      SELECT DISTINCT company_id, location
      FROM item_inv
      WHERE location IS NOT NULL AND location != ''
    `);
    console.log(`  Inserted ${locResult.affectedRows} locations`);

    // Step 2: Backfill item_inv.location_id
    console.log('Step 2: Backfilling location_id in item_inv...');
    const [backfillResult] = await pool.query(`
      UPDATE item_inv i
      JOIN locations l ON i.company_id = l.company_id AND i.location = l.location_name
      SET i.location_id = l.location_id
      WHERE i.location_id IS NULL
    `);
    console.log(`  Updated ${backfillResult.affectedRows} item_inv rows`);

    // Step 3: Seed company_sub_location_paths
    console.log('Step 3: Seeding company_sub_location_paths...');

    const [rows] = await pool.query(`
      SELECT DISTINCT company_id, location_id, sub_location
      FROM item_inv
      WHERE location_id IS NOT NULL
        AND sub_location IS NOT NULL
        AND JSON_VALID(sub_location)
        AND JSON_TYPE(sub_location) = 'ARRAY'
        AND JSON_LENGTH(sub_location) > 0
    `);

    console.log(`  Found ${rows.length} distinct (company, location, sub_location) combinations`);

    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      let segments;
      try {
        const parsed =
          typeof row.sub_location === 'string'
            ? JSON.parse(row.sub_location)
            : row.sub_location;

        if (!Array.isArray(parsed)) { skipped++; continue; }

        let valid = true;
        const filtered = [];

        for (const elem of parsed) {
          if (elem === null) continue;                    // skip nulls
          if (typeof elem !== 'string') { valid = false; break; }  // object/number → invalid path
          const trimmed = elem.trim();
          if (trimmed) filtered.push(trimmed);
        }

        if (!valid || filtered.length === 0) { skipped++; continue; }

        segments = filtered;
      } catch {
        skipped++;
        continue;
      }

      const pathKey  = segments.join(' > ');
      const pathJson = JSON.stringify(segments);

      await pool.query(
        `INSERT IGNORE INTO company_sub_location_paths
           (company_id, location_id, path_json, path_key)
         VALUES (?, ?, ?, ?)`,
        [row.company_id, row.location_id, pathJson, pathKey]
      );
      inserted++;
    }

    console.log(`  Paths: ${inserted} inserted, ${skipped} skipped`);
    console.log('\nDone!');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
