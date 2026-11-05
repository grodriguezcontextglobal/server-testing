/**
 * Diagnóstico de SOLO LECTURA de las locaciones duplicadas (2026-10-16).
 *
 *   node mysql/scripts/diagnose-duplicate-locations.js            # resumen + tabla por grupo
 *   node mysql/scripts/diagnose-duplicate-locations.js --json     # además escribe logs/duplicate-locations-<fecha>.json
 *
 * Hallazgo del backfill de W5: `locations` tiene la misma locación repetida
 * dentro de su compañía (255 filas para 128 locaciones el 2026-10-16; 42 con 4
 * copias). Antes de fusionar hace falta saber qué usa cada copia. Este script
 * solo hace SELECT:
 *
 *   1. Esquema: qué tablas tienen una columna `location_id` (o `sub_location_id`)
 *      y qué claves foráneas apuntan a `locations` / `sub_locations` (ojo:
 *      sub_locations → locations es ON DELETE CASCADE: borrar una copia sin
 *      repuntar antes borra sus sublocaciones).
 *   2. Grupos: (company_id, nombre normalizado) con más de una fila, y la copia
 *      que se quedaría (la más referenciada; en empate, el id más bajo).
 *   3. Por tabla: cuántas filas apuntan a copias que desaparecerían.
 *   4. Sublocaciones: al fusionar, las de las copias pasan a la canónica; las que
 *      se llamen igual en el mismo nivel colisionan y también habría que fusionarlas.
 *   5. staff_location_access: filas que quedarían duplicadas tras repuntar.
 *   6. Si `locations` tiene un índice único (company_id, location_name).
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');

const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Función pura: agrupa duplicados y elige la copia canónica.
 * @param {Array<{location_id:number, company_id:number, location_name:string}>} locations
 * @param {Map<number, number>} refsById  location_id → referencias totales
 */
function groupDuplicates(locations, refsById) {
  const groups = new Map();
  for (const l of locations) {
    const key = `${l.company_id}:${norm(l.location_name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const out = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const ranked = [...rows].sort(
      (a, b) => (refsById.get(b.location_id) ?? 0) - (refsById.get(a.location_id) ?? 0) || a.location_id - b.location_id,
    );
    out.push({
      key,
      company_id: rows[0].company_id,
      name: ranked[0].location_name,
      canonical: ranked[0].location_id,
      duplicates: ranked.slice(1).map((r) => r.location_id),
      variants: [...new Set(rows.map((r) => r.location_name))],
    });
  }
  return out.sort((a, b) => a.company_id - b.company_id || a.name.localeCompare(b.name));
}

async function main() {
  const getConnection = require('../database/config');
  const sql = getConnection();
  const q = async (text, params = []) => (await sql.query(text, params))[0];

  const [ident] = await q('SELECT DATABASE() AS db, @@hostname AS host');
  console.log('─'.repeat(72));
  console.log(`SQL : ${ident.db} @ ${ident.host}  ·  SOLO LECTURA`);
  console.log('─'.repeat(72));

  // 1. Esquema
  const refCols = await q(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'location_id' AND TABLE_NAME <> 'locations'
      ORDER BY TABLE_NAME`,
  );
  const fks = await q(
    `SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, k.REFERENCED_TABLE_NAME AS ref, r.DELETE_RULE AS on_delete
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IN ('locations', 'sub_locations')`,
  );
  const idx = await q(
    `SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
      GROUP BY INDEX_NAME, NON_UNIQUE`,
  );
  console.log('\n1) Tablas con location_id:', refCols.map((r) => r.t).join(', ') || '(ninguna)');
  console.log('   Claves foráneas hacia locations / sub_locations:');
  if (fks.length) console.table(fks); else console.log('   (ninguna declarada — PlanetScale/Vitess suele no tenerlas)');
  console.log('   Índices de locations:');
  console.table(idx);
  const hasUnique = idx.some((i) => Number(i.non_unique) === 0 && /company_id/.test(i.cols) && /location_name/.test(i.cols));
  console.log(`   ¿UNIQUE (company_id, location_name)? ${hasUnique ? 'sí' : 'NO'}`);

  // 2. Referencias por location_id en cada tabla
  const locations = await q('SELECT location_id, company_id, location_name FROM locations');
  const refsByTable = {};
  const refsById = new Map();
  for (const { t } of refCols) {
    const rows = await q(`SELECT location_id AS id, COUNT(*) AS n FROM \`${t}\` WHERE location_id IS NOT NULL GROUP BY location_id`);
    refsByTable[t] = new Map(rows.map((r) => [Number(r.id), Number(r.n)]));
    for (const r of rows) refsById.set(Number(r.id), (refsById.get(Number(r.id)) ?? 0) + Number(r.n));
  }

  const groups = groupDuplicates(locations, refsById);
  const distinct = new Set(locations.map((l) => `${l.company_id}:${norm(l.location_name)}`)).size;
  console.log(`\n2) locations: ${locations.length} filas, ${distinct} locaciones distintas, ${groups.length} grupos duplicados`);
  const byCopies = groups.reduce((acc, g) => ({ ...acc, [g.duplicates.length + 1]: (acc[g.duplicates.length + 1] ?? 0) + 1 }), {});
  console.log('   grupos por número de copias:', byCopies);

  // 3. Filas a repuntar por tabla (las que apuntan a una copia que desaparece)
  const dupIds = new Set(groups.flatMap((g) => g.duplicates));
  const toRepoint = {};
  for (const [t, m] of Object.entries(refsByTable)) {
    toRepoint[t] = [...m.entries()].filter(([id]) => dupIds.has(id)).reduce((s, [, n]) => s + n, 0);
  }
  console.log('\n3) Filas que apuntan a una copia que desaparecería (habría que repuntarlas):');
  console.table(toRepoint);

  // 4. Sublocaciones: colisiones de nombre al moverlas a la canónica (mismo padre)
  let subCollisions = [];
  const hasSubLocations = refCols.some((r) => r.t === 'sub_locations');
  if (hasSubLocations && groups.length) {
    const groupIds = groups.flatMap((g) => [g.canonical, ...g.duplicates]);
    const subCols = (await q(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sub_locations'`,
    )).map((r) => r.c);
    const nameCol = subCols.includes('sub_location_name') ? 'sub_location_name' : subCols.includes('name') ? 'name' : null;
    const parentCol = subCols.includes('parent_id') ? 'parent_id' : subCols.includes('parent_sub_location_id') ? 'parent_sub_location_id' : null;
    if (nameCol) {
      const subs = await q(
        `SELECT sub_location_id, location_id, \`${nameCol}\` AS name${parentCol ? `, \`${parentCol}\` AS parent` : ''}
           FROM sub_locations WHERE location_id IN (?)`,
        [groupIds],
      );
      for (const g of groups) {
        const members = new Set([g.canonical, ...g.duplicates]);
        const seen = new Map();
        for (const s of subs.filter((x) => members.has(Number(x.location_id)) && (parentCol ? x.parent == null : true))) {
          const k = norm(s.name);
          if (!seen.has(k)) seen.set(k, []);
          seen.get(k).push(Number(s.sub_location_id));
        }
        for (const [k, ids] of seen) if (ids.length > 1) subCollisions.push({ company_id: g.company_id, location: g.name, sub_location: k, ids: ids.join(',') });
      }
      console.log(`\n4) Sublocaciones de primer nivel que colisionarían al fusionar: ${subCollisions.length}`);
      if (subCollisions.length) console.table(subCollisions.slice(0, 30));
      if (subCollisions.length > 30) console.log(`   … y ${subCollisions.length - 30} más (ver --json)`);
    } else {
      console.log('\n4) sub_locations: no encuentro la columna de nombre; revisar a mano.');
    }
  }

  // 5. staff_location_access que quedaría duplicada tras repuntar
  let accessDupes = 0;
  if (refCols.some((r) => r.t === 'staff_location_access') && groups.length) {
    const canonOf = new Map(groups.flatMap((g) => g.duplicates.map((d) => [d, g.canonical])));
    const rows = await q('SELECT company_staff_id, location_id FROM staff_location_access');
    const seen = new Set();
    for (const r of rows) {
      const k = `${r.company_staff_id}:${canonOf.get(Number(r.location_id)) ?? Number(r.location_id)}`;
      if (seen.has(k)) accessDupes += 1; else seen.add(k);
    }
    console.log(`\n5) staff_location_access que quedarían duplicadas tras repuntar: ${accessDupes}`);
  }

  // Detalle por grupo
  console.log('\nGrupos (canónica = la que se queda):');
  console.table(groups.map((g) => {
    const row = { company_id: g.company_id, location: g.name, canonical: g.canonical, duplicates: g.duplicates.join(',') };
    for (const [t, m] of Object.entries(refsByTable)) {
      const n = [g.canonical, ...g.duplicates].map((id) => `${id}:${m.get(id) ?? 0}`).join(' ');
      if (/:[1-9]/.test(n)) row[t] = n;
    }
    if (g.variants.length > 1) row.variants = g.variants.join(' | ');
    return row;
  }));

  if (process.argv.includes('--json')) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const file = path.resolve(__dirname, `../../logs/duplicate-locations-${stamp}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      generated_at: new Date().toISOString(), db: ident.db, hasUnique, fks, toRepoint, accessDupes, subCollisions,
      groups: groups.map((g) => ({
        ...g,
        refs: Object.fromEntries(Object.entries(refsByTable).map(([t, m]) => [t, Object.fromEntries([g.canonical, ...g.duplicates].map((id) => [id, m.get(id) ?? 0]))])),
      })),
    }, null, 2));
    console.log(`\nJSON: ${file}`);
  }

  console.log('\n(solo lectura — no se modificó nada)');
  await sql.end?.();
}

module.exports = { groupDuplicates, norm };

if (require.main === module) {
  main().catch((error) => {
    console.error('DIAGNOSE FAILED:', error.message);
    process.exit(1);
  });
}
