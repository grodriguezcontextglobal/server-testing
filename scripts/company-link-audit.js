'use strict';

/**
 * ¿Cuántas compañías NO se resuelven entre Mongo y SQL? — SOLO LECTURA.
 *
 * POR QUE EXISTE. Las dos bases no comparten ningún identificador. Se enlazan
 * por IGUALDAD EXACTA DE CADENA del nombre de la compañía, en los dos sentidos
 * (helpers/planLimits.js:123 y :134):
 *
 *     SELECT company_id FROM company_info WHERE company_name = ? LIMIT 1
 *
 * Mientras los dos nombres coincidan, funciona. Un renombrado en una sola de
 * las dos bases, un espacio de más, un acento o una mayúscula distinta, y deja
 * de resolver. Y lo que hay detrás de esa resolución no es un adorno: el plan
 * de suscripción, los topes, el inventario y las transacciones de esa compañía,
 * y —según el dashboard, con un caso real del 2026-11-19— el inicio de sesión
 * de personas que se quedan fuera del producto.
 *
 * Negarse a resolver es lo CORRECTO: la alternativa es emparejar con la
 * compañía equivocada y enseñarle a un cliente los datos de otro. Lo que está
 * mal es que el enlace dependa de un nombre que alguien puede editar.
 *
 * ESTE SCRIPT NO ARREGLA NADA. Mide, para poder decidir con un número delante
 * si esto es un arreglo de datos de dos filas o una migración con columna nueva
 * y backfill. No escribe en ninguna de las dos bases.
 *
 *   node scripts/company-link-audit.js
 *       Resumen y las compañías que no resuelven, con el motivo.
 *
 *   node scripts/company-link-audit.js --all
 *       Además, la tabla completa incluyendo las que sí resuelven.
 *
 *   node scripts/company-link-audit.js --json
 *       La misma información en JSON, para guardarla como evidencia.
 *
 * CUIDADO CON LA SALIDA: lleva nombres de compañías cliente y conteos de su
 * personal. Es material de cliente; no se pega en un chat ni en un ticket tal
 * cual. Nunca imprime datos de personas.
 */

const normalize = (value) => String(value ?? '').trim().toLowerCase();

/**
 * La clave con la que se buscan los "casi": minúsculas, sin acentos, sin signos
 * de puntuación y con los espacios colapsados.
 *
 * Sirve SOLO para explicar por qué falló un cruce — para distinguir "esta
 * compañía no está en SQL" de "está, escrita de otra forma". NO se propone como
 * regla de emparejamiento: aflojar la comparación es exactamente el error que
 * acaba enseñándole a un cliente los datos de otro. El arreglo es un id, no una
 * comparación más indulgente.
 */
const fuzzyKey = (value) =>
  normalize(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Cuántos empleados activos tiene la compañía, que es "cuánta gente se queda fuera". */
const activeStaffCount = (company) =>
  (company.employees || []).filter((e) => e?.active !== false).length;

const REASONS = Object.freeze({
  OK: 'ok',
  NO_SQL_ROW: 'no_sql_row',
  NAME_DIFFERS: 'name_differs',
  AMBIGUOUS: 'ambiguous',
  NO_NAME: 'no_name',
});

/**
 * El núcleo, sin E/S para poder probarlo.
 *
 * @param companies      [{_id, company_name, employees}]  de Mongo
 * @param sqlRows        [{company_id, company_name}]      de company_info
 * @param subscriptions  [{company, sql_company_id}]       de CompanySubscription
 */
function auditCompanyLinks({ companies, sqlRows, subscriptions }) {
  // Índice exacto: el MISMO cruce que hace resolveSqlCompanyId. Si un nombre
  // está repetido en SQL, se guardan los dos: `LIMIT 1` elige uno en silencio,
  // y eso es un hallazgo por si solo.
  const exact = new Map();
  for (const row of sqlRows) {
    const key = String(row.company_name ?? '');
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(row);
  }

  const fuzzy = new Map();
  for (const row of sqlRows) {
    const key = fuzzyKey(row.company_name);
    if (!key) continue;
    if (!fuzzy.has(key)) fuzzy.set(key, []);
    fuzzy.get(key).push(row);
  }

  const cachedByCompany = new Map();
  for (const sub of subscriptions || []) {
    if (sub?.company && sub?.sql_company_id) {
      cachedByCompany.set(String(sub.company), Number(sub.sql_company_id));
    }
  }
  const sqlIds = new Set(sqlRows.map((r) => Number(r.company_id)));

  const findings = [];
  for (const company of companies) {
    const name = String(company.company_name ?? '');
    const staff = activeStaffCount(company);
    const cached = cachedByCompany.get(String(company._id)) ?? null;

    // El id cacheado en CompanySubscription se mira aparte: salva el cruce
    // cuando existe, pero se guardo con el nombre de ENTONCES. Si apunta a una
    // fila que ya no esta, es peor que no tenerlo.
    const cachedOrphan = cached !== null && !sqlIds.has(cached);

    const base = {
      companyId: String(company._id),
      companyName: name,
      activeStaff: staff,
      cachedSqlId: cached,
      cachedOrphan,
    };

    if (!name.trim()) {
      findings.push({ ...base, reason: REASONS.NO_NAME, sqlCompanyId: null });
      continue;
    }

    const hits = exact.get(name) || [];
    if (hits.length === 1) {
      findings.push({ ...base, reason: REASONS.OK, sqlCompanyId: Number(hits[0].company_id) });
      continue;
    }
    if (hits.length > 1) {
      findings.push({
        ...base,
        reason: REASONS.AMBIGUOUS,
        sqlCompanyId: null,
        candidates: hits.map((r) => ({ id: Number(r.company_id), name: r.company_name })),
      });
      continue;
    }

    const near = fuzzy.get(fuzzyKey(name)) || [];
    findings.push({
      ...base,
      reason: near.length ? REASONS.NAME_DIFFERS : REASONS.NO_SQL_ROW,
      sqlCompanyId: null,
      candidates: near.map((r) => ({ id: Number(r.company_id), name: r.company_name })),
    });
  }

  // El otro sentido: filas de SQL que ningun nombre de Mongo alcanza. Importan
  // porque resolveMongoCompanyId hace el cruce al reves, y porque una compañia
  // solo en SQL es inventario y transacciones sin dueño en Mongo.
  const mongoNames = new Set(companies.map((c) => String(c.company_name ?? '')));
  const orphanSqlRows = sqlRows
    .filter((r) => !mongoNames.has(String(r.company_name ?? '')))
    .map((r) => ({ sqlCompanyId: Number(r.company_id), companyName: String(r.company_name ?? '') }));

  const by = (reason) => findings.filter((f) => f.reason === reason);
  const broken = findings.filter((f) => f.reason !== REASONS.OK);

  return {
    findings,
    orphanSqlRows,
    summary: {
      mongoCompanies: companies.length,
      sqlCompanies: sqlRows.length,
      ok: by(REASONS.OK).length,
      noSqlRow: by(REASONS.NO_SQL_ROW).length,
      nameDiffers: by(REASONS.NAME_DIFFERS).length,
      ambiguous: by(REASONS.AMBIGUOUS).length,
      noName: by(REASONS.NO_NAME).length,
      orphanSqlRows: orphanSqlRows.length,
      // Lo que de verdad decide la prioridad: cuanta gente esta detras de un
      // cruce roto. Una compañia rota sin personal activo es deuda; una con
      // veinte personas es un incidente.
      staffBehindBrokenLinks: broken.reduce((n, f) => n + f.activeStaff, 0),
      cachedOrphans: findings.filter((f) => f.cachedOrphan).length,
    },
  };
}

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();

  const Company = require('../models/Company');
  const CompanySubscription = require('../models/CompanySubscription');
  const pool = require('../mysql/database/config')();

  try {
    const companies = await Company.find({})
      .select('company_name employees.active')
      .lean();
    const [sqlRows] = await pool.query('SELECT company_id, company_name FROM company_info');
    const subscriptions = await CompanySubscription.find({})
      .select('company sql_company_id')
      .lean();

    const report = auditCompanyLinks({ companies, sqlRows, subscriptions });

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const s = report.summary;
    console.log('\nEnlace Mongo <-> SQL por nombre de compañia (solo lectura)\n');
    console.table([
      { metrica: 'compañias en Mongo', valor: s.mongoCompanies },
      { metrica: 'filas en company_info', valor: s.sqlCompanies },
      { metrica: 'resuelven bien', valor: s.ok },
      { metrica: 'sin fila en SQL', valor: s.noSqlRow },
      { metrica: 'el nombre difiere (hay candidata)', valor: s.nameDiffers },
      { metrica: 'nombre repetido en SQL', valor: s.ambiguous },
      { metrica: 'sin nombre en Mongo', valor: s.noName },
      { metrica: 'filas SQL sin compañia en Mongo', valor: s.orphanSqlRows },
      { metrica: 'id cacheado que ya no existe', valor: s.cachedOrphans },
      { metrica: 'PERSONAL ACTIVO tras un cruce roto', valor: s.staffBehindBrokenLinks },
    ]);

    const broken = report.findings.filter((f) => f.reason !== REASONS.OK);
    if (broken.length) {
      console.log('\nCompañias que NO resuelven:\n');
      console.table(
        broken.map((f) => ({
          company_name: f.companyName || '(sin nombre)',
          reason: f.reason,
          active_staff: f.activeStaff,
          cached_sql_id: f.cachedSqlId ?? '-',
          candidates: (f.candidates || []).map((c) => `${c.id}:${c.name}`).join(' | ') || '-',
        }))
      );
      console.log(
        '\n  name_differs  = existe en SQL escrita de otra forma. Un renombrado en una sola base.\n' +
          '  no_sql_row    = no hay nada parecido. O es nueva, o se borro, o nunca se creo.\n' +
          '  ambiguous     = el nombre esta repetido en company_info y `LIMIT 1` elige uno en silencio.\n'
      );
    } else {
      console.log('\nTodas las compañias de Mongo resuelven hoy.\n');
    }

    if (report.orphanSqlRows.length) {
      console.log('Filas de company_info sin compañia en Mongo con ese nombre:\n');
      console.table(report.orphanSqlRows.slice(0, 50));
      if (report.orphanSqlRows.length > 50) {
        console.log(`  ... y ${report.orphanSqlRows.length - 50} mas (usa --json).`);
      }
    }

    if (process.argv.includes('--all')) {
      console.log('\nTodas, incluyendo las que resuelven:\n');
      console.table(
        report.findings.map((f) => ({
          company_name: f.companyName || '(sin nombre)',
          reason: f.reason,
          sql_company_id: f.sqlCompanyId ?? '-',
          active_staff: f.activeStaff,
        }))
      );
    }

    console.log(
      '\nEsta salida lleva nombres de compañias cliente: es material de cliente.\n' +
        'Este script no escribe nada en ninguna de las dos bases.\n'
    );
  } finally {
    await mongoose.disconnect();
    if (pool?.end) await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { auditCompanyLinks, fuzzyKey, REASONS };
