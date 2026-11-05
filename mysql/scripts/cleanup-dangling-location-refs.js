/**
 * Limpieza de referencias rotas a locaciones (2026-10-19).
 *
 *   node mysql/scripts/cleanup-dangling-location-refs.js           # DRY-RUN: solo lee y muestra el plan
 *   node mysql/scripts/cleanup-dangling-location-refs.js --apply   # borra, en UNA transacción
 *
 * Contexto: diagnose-dangling-location-refs.js. En prod (2026-10-19) solo
 * quedaba estructura VACÍA de locaciones borradas antes por otras vías (sin FKs
 * en PlanetScale, nada lo impidió): 6 sublocaciones, 7 rutas y 1 permiso
 * huérfano, de compañías de prueba. Ningún ítem.
 *
 * Borra, recalculado al correr:
 *   - staff_location_access       cuya locación no existe
 *   - company_sub_location_paths  cuya locación no existe
 *   - sub_locations               cuya locación no existe (el árbol entero)
 *
 * BLOQUEO: no aplica nada si algún ítem apunta a una locación inexistente o a una
 * de esas sublocaciones. Eso ya no es estructura vacía: hay inventario que
 * reubicar antes, y no se decide aquí.
 *
 * Con --apply guarda ANTES en logs/cleanup-dangling-location-refs-<fecha>.json
 * todas las filas que borra, y comprueba dentro de la transacción que no queda
 * ninguna referencia rota antes del commit.
 *
 * tmp_item_subloc_parts NO se toca: es una tabla sobrante de una migración, sin
 * uso en el código; se elimina con DROP TABLE por deploy request de PlanetScale.
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });
const fs = require('fs');
const path = require('path');

const MISSING = (alias) => `NOT EXISTS (SELECT 1 FROM locations l WHERE l.location_id = ${alias}.location_id)`;

/**
 * Función pura: qué se borra y qué lo impide.
 * @param {object} input
 * @param {object[]} input.access     staff_location_access sin locación
 * @param {object[]} input.paths      company_sub_location_paths sin locación
 * @param {object[]} input.subs       sub_locations sin locación
 * @param {number} input.itemsOnMissingLocation   ítems con location_id inexistente
 * @param {Map<number, number>} input.itemsBySub  sub_location_id → ítems
 */
function planCleanup({ access, paths, subs, itemsOnMissingLocation, itemsBySub }) {
  const blockers = [];
  if (itemsOnMissingLocation > 0) blockers.push({ what: 'item_inv.location_id → locación inexistente', items: itemsOnMissingLocation });
  const subsWithItems = subs
    .map((s) => ({ sub_location_id: Number(s.sub_location_id), items: itemsBySub.get(Number(s.sub_location_id)) ?? 0 }))
    .filter((s) => s.items > 0);
  for (const s of subsWithItems) blockers.push({ what: `sub_location ${s.sub_location_id} tiene ítems`, items: s.items });
  return {
    blockers,
    deleteAccess: access.map((a) => a.id),
    deletePaths: paths.map((p) => Number(p.path_id)),
    deleteSubs: subs.map((s) => Number(s.sub_location_id)),
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const getConnection = require('../database/config');
  const pool = getConnection();
  const q = async (conn, text, params = []) => (await conn.query(text, params))[0];

  const [ident] = await q(pool, 'SELECT DATABASE() AS db, @@hostname AS host');
  console.log('─'.repeat(72));
  console.log(`SQL  : ${ident.db} @ ${ident.host}`);
  console.log(`Modo : ${apply ? 'APPLY (borra, en una transacción)' : 'DRY-RUN (solo lectura)'}`);
  console.log('─'.repeat(72));

  const conn = apply ? await pool.getConnection() : pool;
  try {
    if (apply) await conn.beginTransaction();

    const access = await q(conn, `SELECT * FROM staff_location_access x WHERE ${MISSING('x')}`);
    const paths = await q(conn, `SELECT * FROM company_sub_location_paths x WHERE ${MISSING('x')}`);
    const subs = await q(conn, `SELECT * FROM sub_locations x WHERE ${MISSING('x')}`);
    const [[{ n: itemsOnMissingLocation }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM item_inv x WHERE x.location_id IS NOT NULL AND ${MISSING('x')}`,
    );
    const itemsBySub = new Map();
    if (subs.length) {
      const rows = await q(conn,
        'SELECT sub_location_id AS id, COUNT(*) AS n FROM item_inv WHERE sub_location_id IN (?) GROUP BY sub_location_id',
        [subs.map((s) => s.sub_location_id)],
      );
      rows.forEach((r) => itemsBySub.set(Number(r.id), Number(r.n)));
    }

    const plan = planCleanup({ access, paths, subs, itemsOnMissingLocation: Number(itemsOnMissingLocation), itemsBySub });
    console.log(`\nA borrar: ${plan.deleteAccess.length} permisos · ${plan.deletePaths.length} rutas · ${plan.deleteSubs.length} sublocaciones`);
    if (access.length) { console.log('\nstaff_location_access:'); console.table(access.map((a) => ({ id: a.id, company_staff_id: a.company_staff_id, location_id: a.location_id }))); }
    if (paths.length) { console.log('\ncompany_sub_location_paths:'); console.table(paths.map((p) => ({ path_id: p.path_id, company_id: p.company_id, location_id: p.location_id, path_key: p.path_key }))); }
    if (subs.length) { console.log('\nsub_locations:'); console.table(subs.map((s) => ({ sub_location_id: s.sub_location_id, company_id: s.company_id, location_id: s.location_id, name: s.name, parent_id: s.parent_id }))); }

    if (plan.blockers.length) {
      console.log('\n✗ BLOQUEADO: hay inventario colgado de lo que se borraría. Reubicarlo antes.');
      console.table(plan.blockers);
      if (apply) await conn.rollback();
      process.exitCode = 1;
      return;
    }

    const total = plan.deleteAccess.length + plan.deletePaths.length + plan.deleteSubs.length;
    if (!apply) {
      console.log('\n(dry-run — no se borró nada; repetir con --apply)');
    } else if (total === 0) {
      await conn.rollback();
      console.log('\nNada que limpiar.');
    } else {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const backupFile = path.resolve(__dirname, `../../logs/cleanup-dangling-location-refs-${stamp}.json`);
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
      fs.writeFileSync(backupFile, JSON.stringify({
        generated_at: new Date().toISOString(), db: ident.db,
        staff_location_access: access, company_sub_location_paths: paths, sub_locations: subs,
      }, null, 2));
      console.log(`\nCopia de seguridad: ${backupFile}`);

      if (plan.deleteAccess.length) await conn.query('DELETE FROM staff_location_access WHERE id IN (?)', [plan.deleteAccess]);
      if (plan.deletePaths.length) await conn.query('DELETE FROM company_sub_location_paths WHERE path_id IN (?)', [plan.deletePaths]);
      if (plan.deleteSubs.length) await conn.query('DELETE FROM sub_locations WHERE sub_location_id IN (?)', [plan.deleteSubs]);

      for (const t of ['staff_location_access', 'company_sub_location_paths', 'sub_locations']) {
        const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\` x WHERE ${MISSING('x')}`);
        if (Number(n) > 0) throw new Error(`${t} sigue con ${n} referencias rotas`);
      }
      await conn.commit();
      console.log(`\n✓ Limpieza hecha: ${plan.deleteAccess.length} permisos, ${plan.deletePaths.length} rutas y ${plan.deleteSubs.length} sublocaciones borradas.`);
    }
    console.log('\nPendiente aparte (deploy request de PlanetScale): DROP TABLE tmp_item_subloc_parts;');
  } catch (error) {
    if (apply) await conn.rollback().catch(() => {});
    console.error('\n✗ Falló; no se borró nada (rollback):', error.message);
    process.exitCode = 1;
  } finally {
    if (apply) conn.release();
    await pool.end?.();
  }
}

module.exports = { planCleanup };

if (require.main === module) main();
