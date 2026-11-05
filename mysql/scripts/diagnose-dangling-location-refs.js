/**
 * Diagnóstico de SOLO LECTURA de las referencias rotas a locaciones y
 * sublocaciones (2026-10-19).
 *
 *   node mysql/scripts/diagnose-dangling-location-refs.js          # informe
 *   node mysql/scripts/diagnose-dangling-location-refs.js --json   # además logs/dangling-location-refs-<fecha>.json
 *
 * Tras fusionar las locaciones duplicadas (merge-duplicate-locations.js) quedaron
 * filas que apuntan a locaciones que ya no existían ANTES de la fusión: se
 * borraron por otras vías (p. ej. location_id = 1 en una auditoría de septiembre).
 * No hay claves foráneas en prod (PlanetScale), así que nada lo impidió.
 *
 * Revisa:
 *   A. sub_locations.location_id            → locations
 *   B. sub_locations.parent_id              → sub_locations
 *   C. company_sub_location_paths.location_id → locations
 *   D. staff_location_access.location_id    → locations
 *   E. item_inv.location_id                 → locations
 *   F. item_inv.sub_location_id             → sub_locations
 *   G. ítems colgados de una sublocación cuya locación ya no existe
 *   H. tmp_item_subloc_parts: tabla sin uso en el código
 *
 * Para cada locación que falta intenta deducir su nombre (la columna de texto
 * item_inv.location de los ítems que cuelgan de sus sublocaciones) y busca si hoy
 * existe una locación de la misma compañía con ese nombre: candidata a repuntar.
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });
const fs = require('fs');
const path = require('path');

const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Función pura: para una locación que falta, la candidata existente.
 * @param {string[]} inferredNames  nombres vistos en item_inv.location (puede haber varios)
 * @param {Array<{location_id, location_name}>} companyLocations  locaciones vivas de esa compañía
 * @returns {{ name: string|null, candidate: number|null, why: string }}
 */
function suggestRepoint(inferredNames, companyLocations) {
  const names = [...new Set(inferredNames.map(norm).filter(Boolean))];
  if (names.length === 0) return { name: null, candidate: null, why: 'sin nombre que deducir' };
  if (names.length > 1) return { name: names.join(' | '), candidate: null, why: 'varios nombres: revisar a mano' };
  const matches = companyLocations.filter((l) => norm(l.location_name) === names[0]);
  if (matches.length === 1) return { name: names[0], candidate: Number(matches[0].location_id), why: 'mismo nombre en la compañía' };
  if (matches.length > 1) return { name: names[0], candidate: null, why: 'varias locaciones con ese nombre' };
  return { name: names[0], candidate: null, why: 'no existe ninguna con ese nombre: recrearla o borrar' };
}

async function main() {
  const getConnection = require('../database/config');
  const sql = getConnection();
  const q = async (text, params = []) => (await sql.query(text, params))[0];

  const [ident] = await q('SELECT DATABASE() AS db, @@hostname AS host');
  console.log('─'.repeat(72));
  console.log(`SQL : ${ident.db} @ ${ident.host}  ·  SOLO LECTURA`);
  console.log('─'.repeat(72));

  const report = {};
  const show = (title, rows, max = 40) => {
    console.log(`\n${title}: ${rows.length}`);
    if (rows.length) console.table(rows.slice(0, max));
    if (rows.length > max) console.log(`   … y ${rows.length - max} más (ver --json)`);
  };

  // A. sublocaciones cuya locación no existe
  report.A_sub_locations_missing_location = await q(
    `SELECT s.sub_location_id, s.location_id, s.company_id, s.name, s.parent_id, s.active,
            (SELECT COUNT(*) FROM item_inv i WHERE i.sub_location_id = s.sub_location_id) AS items
       FROM sub_locations s
      WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.location_id = s.location_id)
      ORDER BY s.location_id, s.sub_location_id`,
  );
  show('A. sub_locations → locación inexistente', report.A_sub_locations_missing_location);

  // B. sublocaciones cuyo padre no existe
  report.B_sub_locations_missing_parent = await q(
    `SELECT s.sub_location_id, s.parent_id, s.location_id, s.company_id, s.name
       FROM sub_locations s
      WHERE s.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sub_locations p WHERE p.sub_location_id = s.parent_id)`,
  );
  show('B. sub_locations → padre inexistente', report.B_sub_locations_missing_parent);

  // C. rutas cuya locación no existe
  report.C_paths_missing_location = await q(
    `SELECT p.path_id, p.company_id, p.location_id, p.path_key, p.created_at
       FROM company_sub_location_paths p
      WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.location_id = p.location_id)
      ORDER BY p.location_id`,
  );
  show('C. company_sub_location_paths → locación inexistente', report.C_paths_missing_location);

  // D. permisos cuya locación no existe
  report.D_access_missing_location = await q(
    `SELECT sla.id, sla.company_staff_id, sla.location_id,
            cs.company_id, sm.email, r.role_level, r.role_type,
            (cs.id IS NULL) AS orphan_company_staff
       FROM staff_location_access sla
       LEFT JOIN company_staff cs ON cs.id = sla.company_staff_id
       LEFT JOIN roles r ON r.id = cs.role_id
       LEFT JOIN staff_member sm ON sm.staff_id = cs.staff_id
      WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.location_id = sla.location_id)`,
  );
  show('D. staff_location_access → locación inexistente', report.D_access_missing_location);

  // E/F. ítems
  report.E_items_missing_location = await q(
    `SELECT i.company_id, i.location_id, i.location, COUNT(*) AS items
       FROM item_inv i
      WHERE i.location_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.location_id = i.location_id)
      GROUP BY i.company_id, i.location_id, i.location`,
  );
  show('E. item_inv.location_id → locación inexistente (grupos)', report.E_items_missing_location);

  report.F_items_missing_sub_location = await q(
    `SELECT i.company_id, i.sub_location_id, i.location_id, COUNT(*) AS items
       FROM item_inv i
      WHERE i.sub_location_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sub_locations s WHERE s.sub_location_id = i.sub_location_id)
      GROUP BY i.company_id, i.sub_location_id, i.location_id`,
  );
  show('F. item_inv.sub_location_id → sublocación inexistente (grupos)', report.F_items_missing_sub_location);

  // G. ítems en una sublocación huérfana (A): su ruta no lleva a ninguna locación
  report.G_items_under_orphan_sub_locations = await q(
    `SELECT i.company_id, i.sub_location_id, s.location_id AS missing_location_id, i.location_id AS item_location_id,
            i.location AS item_location_text, COUNT(*) AS items
       FROM item_inv i
       JOIN sub_locations s ON s.sub_location_id = i.sub_location_id
      WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.location_id = s.location_id)
      GROUP BY i.company_id, i.sub_location_id, s.location_id, i.location_id, i.location`,
  );
  show('G. ítems colgados de una sublocación huérfana (grupos)', report.G_items_under_orphan_sub_locations);

  // Locaciones que faltan: nombre deducido y candidata a repuntar
  const missing = new Map(); // location_id → { companies:Set, names:[] }
  const note = (id, company, name) => {
    if (id == null) return;
    if (!missing.has(id)) missing.set(id, { companies: new Set(), names: [] });
    if (company != null) missing.get(id).companies.add(Number(company));
    if (name) missing.get(id).names.push(name);
  };
  report.A_sub_locations_missing_location.forEach((r) => note(Number(r.location_id), r.company_id));
  report.C_paths_missing_location.forEach((r) => note(Number(r.location_id), r.company_id));
  report.D_access_missing_location.forEach((r) => note(Number(r.location_id), r.company_id));
  report.E_items_missing_location.forEach((r) => note(Number(r.location_id), r.company_id, r.location));
  report.G_items_under_orphan_sub_locations.forEach((r) => note(Number(r.missing_location_id), r.company_id, r.item_location_text));

  const live = await q('SELECT location_id, company_id, location_name FROM locations');
  const companies = await q('SELECT company_id, company_name FROM company_info');
  const companyName = new Map(companies.map((c) => [Number(c.company_id), c.company_name]));
  report.missing_locations = [...missing.entries()].sort((a, b) => a[0] - b[0]).map(([id, info]) => {
    const company = [...info.companies];
    const suggestion = company.length === 1
      ? suggestRepoint(info.names, live.filter((l) => Number(l.company_id) === company[0]))
      : { name: null, candidate: null, why: company.length ? 'varias compañías: revisar a mano' : 'sin compañía' };
    return {
      missing_location_id: id,
      company_id: company.join(','),
      company: company.map((c) => companyName.get(c) ?? '(no existe en company_info)').join(', '),
      inferred_name: suggestion.name,
      candidate_location_id: suggestion.candidate,
      why: suggestion.why,
    };
  });
  show('Locaciones que faltan y candidata para repuntar', report.missing_locations);

  // H. tabla temporal sin uso en el código
  const [tmp] = await q(
    `SELECT CREATE_TIME AS created, TABLE_ROWS AS approx_rows FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tmp_item_subloc_parts'`,
  );
  if (tmp) {
    const [[{ n }]] = await sql.query(
      `SELECT COUNT(*) AS n FROM tmp_item_subloc_parts t
        WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.location_id = t.location_id)`,
    );
    report.H_tmp_table = { ...tmp, dangling_rows: Number(n) };
    console.log('\nH. tmp_item_subloc_parts (ningún archivo del repo la usa):', report.H_tmp_table);
    console.log('   No es una referencia que arreglar: es una tabla sobrante de una migración. Candidata a DROP.');
  }

  if (process.argv.includes('--json')) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const file = path.resolve(__dirname, `../../logs/dangling-location-refs-${stamp}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), db: ident.db, ...report }, null, 2));
    console.log(`\nJSON: ${file}`);
  }
  console.log('\n(solo lectura — no se modificó nada)');
  await sql.end?.();
}

module.exports = { suggestRepoint, norm };

if (require.main === module) {
  main().catch((error) => {
    console.error('DIAGNOSE FAILED:', error.message);
    process.exit(1);
  });
}
