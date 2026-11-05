/**
 * Fusión de locaciones duplicadas (2026-10-16).
 *
 *   node mysql/scripts/merge-duplicate-locations.js            # DRY-RUN: solo lee y muestra el plan
 *   node mysql/scripts/merge-duplicate-locations.js --apply    # escribe, en UNA transacción
 *
 * Contexto: mysql/scripts/diagnose-duplicate-locations.js. En prod (2026-10-16)
 * `locations` tenía 255 filas para 128 locaciones, y ninguna fila de item_inv,
 * sub_locations, company_sub_location_paths ni tmp_item_subloc_parts apuntaba a
 * una copia: solo staff_location_access (filas que dejó migrate-roles.js con su
 * búsqueda global por nombre).
 *
 * El plan se recalcula al correr, no se fía del diagnóstico:
 *
 *   1. Grupos = (company_id, nombre normalizado) con más de una fila. Se queda la
 *      copia más referenciada (en empate, el id más bajo): groupDuplicates().
 *   2. BLOQUEO: si cualquier tabla que no sea staff_location_access apunta a una
 *      copia, no se aplica nada. Hoy son 0; si aparecen, los datos cambiaron desde
 *      el diagnóstico y hay que revisarlos antes de mover ítems.
 *   3. staff_location_access que apunta a una copia:
 *        - company_staff inexistente (huérfana)          → se borra
 *        - el company_staff es de OTRA compañía           → se borra
 *        - misma compañía, la canónica ya la tiene        → se borra (sería duplicada)
 *        - misma compañía                                 → se repunta a la canónica
 *   4. Se borran las copias. Dentro de la transacción se vuelve a contar que nada
 *      las referencia; si algo lo hace, rollback.
 *   5. El índice UNIQUE (company_id, location_name) NO lo crea este script: en
 *      PlanetScale un cambio de esquema va por deploy request. Se imprime la DDL.
 *
 * Con --apply, ANTES de escribir guarda en logs/merge-duplicate-locations-<fecha>.json
 * todas las filas que borra o cambia, para poder deshacerlo.
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const { groupDuplicates } = require('./diagnose-duplicate-locations');

const ACCESS_TABLE = 'staff_location_access';

/**
 * Función pura.
 * @param {object} input
 * @param {Array<{location_id, company_id, location_name}>} input.locations
 * @param {Record<string, Map<number, number>>} input.refsByTable   tabla → (location_id → filas), incluida staff_location_access
 * @param {Array<{id, company_staff_id, location_id}>} input.access  staff_location_access
 * @param {Map<string, number>} input.companyOfStaff                 company_staff.id → company_id
 */
function planMerge({ locations, refsByTable, access, companyOfStaff }) {
  const refsById = new Map();
  for (const m of Object.values(refsByTable)) {
    for (const [id, n] of m) refsById.set(id, (refsById.get(id) ?? 0) + n);
  }
  const groups = groupDuplicates(locations, refsById);
  const canonOf = new Map(groups.flatMap((g) => g.duplicates.map((d) => [d, g.canonical])));
  const companyOfLocation = new Map(locations.map((l) => [Number(l.location_id), Number(l.company_id)]));

  // 2. Bloqueo: otras tablas que apuntan a una copia.
  const blockers = [];
  for (const [table, m] of Object.entries(refsByTable)) {
    if (table === ACCESS_TABLE) continue;
    const rows = [...m.entries()].filter(([id]) => canonOf.has(id)).reduce((s, [, n]) => s + n, 0);
    if (rows > 0) blockers.push({ table, rows });
  }

  // 3. staff_location_access
  const accessDeletes = [];
  const accessRepoints = [];
  const keptPairs = new Set(
    access.filter((a) => !canonOf.has(Number(a.location_id))).map((a) => `${a.company_staff_id}:${Number(a.location_id)}`),
  );
  for (const a of access) {
    const from = Number(a.location_id);
    const to = canonOf.get(from);
    if (to === undefined) continue;
    const staffCompany = companyOfStaff.get(a.company_staff_id);
    if (staffCompany === undefined) { accessDeletes.push({ ...a, reason: 'orphan_company_staff' }); continue; }
    if (staffCompany !== companyOfLocation.get(from)) { accessDeletes.push({ ...a, reason: 'other_company_location', staff_company: staffCompany, location_company: companyOfLocation.get(from) }); continue; }
    const pair = `${a.company_staff_id}:${to}`;
    if (keptPairs.has(pair)) { accessDeletes.push({ ...a, reason: 'canonical_already_assigned' }); continue; }
    keptPairs.add(pair);
    accessRepoints.push({ ...a, to });
  }

  const locationDeletes = groups.flatMap((g) => g.duplicates);
  return { groups, blockers, accessDeletes, accessRepoints, locationDeletes };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const getConnection = require('../database/config');
  const pool = getConnection();
  const q = async (conn, text, params = []) => (await conn.query(text, params))[0];

  const [ident] = await q(pool, 'SELECT DATABASE() AS db, @@hostname AS host');
  console.log('─'.repeat(72));
  console.log(`SQL  : ${ident.db} @ ${ident.host}`);
  console.log(`Modo : ${apply ? 'APPLY (escribe, en una transacción)' : 'DRY-RUN (solo lectura)'}`);
  console.log('─'.repeat(72));

  const conn = apply ? await pool.getConnection() : pool;
  try {
    if (apply) await conn.beginTransaction();

    const refTables = (await q(conn,
      `SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'location_id' AND TABLE_NAME <> 'locations'`,
    )).map((r) => r.t);
    const locations = await q(conn, 'SELECT location_id, company_id, location_name FROM locations');
    const refsByTable = {};
    for (const t of refTables) {
      const rows = await q(conn, `SELECT location_id AS id, COUNT(*) AS n FROM \`${t}\` WHERE location_id IS NOT NULL GROUP BY location_id`);
      refsByTable[t] = new Map(rows.map((r) => [Number(r.id), Number(r.n)]));
    }
    const access = await q(conn, `SELECT * FROM ${ACCESS_TABLE}`);
    const companyStaff = await q(conn, 'SELECT id, company_id FROM company_staff');
    const companyOfStaff = new Map(companyStaff.map((c) => [c.id, Number(c.company_id)]));

    const plan = planMerge({ locations, refsByTable, access, companyOfStaff });
    const { groups, blockers, accessDeletes, accessRepoints, locationDeletes } = plan;

    console.log(`\nGrupos duplicados: ${groups.length}  ·  copias a borrar: ${locationDeletes.length}  ·  locations ${locations.length} → ${locations.length - locationDeletes.length}`);
    console.log(`staff_location_access: borrar ${accessDeletes.length} · repuntar ${accessRepoints.length}`);
    if (accessDeletes.length) {
      console.log('\nPermisos a BORRAR:');
      console.table(accessDeletes.map((a) => ({ id: a.id, company_staff_id: a.company_staff_id, location_id: a.location_id, reason: a.reason })));
    }
    if (accessRepoints.length) {
      console.log('\nPermisos a REPUNTAR a la canónica:');
      console.table(accessRepoints.map((a) => ({ id: a.id, company_staff_id: a.company_staff_id, from: a.location_id, to: a.to })));
    }

    if (blockers.length) {
      console.log('\n✗ BLOQUEADO: otras tablas apuntan a copias que se borrarían. Los datos cambiaron');
      console.log('  desde el diagnóstico; revisarlos (diagnose-duplicate-locations.js) antes de fusionar.');
      console.table(blockers);
      if (apply) await conn.rollback();
      process.exitCode = 1;
      return;
    }

    if (!apply) {
      console.log('\n(dry-run — no se escribió nada; repetir con --apply para fusionar)');
    } else if (locationDeletes.length === 0 && accessDeletes.length === 0 && accessRepoints.length === 0) {
      await conn.rollback();
      console.log('\nNada que fusionar.');
    } else {
      // Copia de seguridad ANTES de escribir.
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const backupFile = path.resolve(__dirname, `../../logs/merge-duplicate-locations-${stamp}.json`);
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
      const deletedLocations = locations.filter((l) => locationDeletes.includes(Number(l.location_id)));
      fs.writeFileSync(backupFile, JSON.stringify({
        generated_at: new Date().toISOString(), db: ident.db,
        deleted_locations: deletedLocations,
        deleted_access: accessDeletes,
        repointed_access: accessRepoints.map((a) => ({ id: a.id, from: a.location_id, to: a.to })),
        groups,
      }, null, 2));
      console.log(`\nCopia de seguridad: ${backupFile}`);

      if (accessDeletes.length) {
        await conn.query(`DELETE FROM ${ACCESS_TABLE} WHERE id IN (?)`, [accessDeletes.map((a) => a.id)]);
      }
      for (const a of accessRepoints) {
        await conn.query(`UPDATE ${ACCESS_TABLE} SET location_id = ? WHERE id = ?`, [a.to, a.id]);
      }
      // Nada puede apuntar ya a las copias: se comprueba antes de borrarlas.
      for (const t of refTables) {
        const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE location_id IN (?)`, [locationDeletes]);
        if (Number(n) > 0) throw new Error(`${t} todavía tiene ${n} filas apuntando a copias`);
      }
      const [res] = await conn.query('DELETE FROM locations WHERE location_id IN (?)', [locationDeletes]);
      await conn.commit();
      console.log(`\n✓ Fusionado: ${res.affectedRows} copias borradas, ${accessDeletes.length} permisos borrados, ${accessRepoints.length} repuntados.`);
    }

    console.log('\nPara que no vuelva a pasar (por deploy request de PlanetScale, DESPUÉS de fusionar):');
    console.log('  ALTER TABLE locations ADD UNIQUE KEY uq_locations_company_name (company_id, location_name);');
  } catch (error) {
    if (apply) await conn.rollback().catch(() => {});
    console.error('\n✗ Falló; no se escribió nada (rollback):', error.message);
    process.exitCode = 1;
  } finally {
    if (apply) conn.release();
    await pool.end?.();
  }
}

module.exports = { planMerge };

if (require.main === module) main();
