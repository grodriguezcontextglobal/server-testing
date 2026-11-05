/**
 * Backfill del alcance por locación: Mongo → SQL (W5 / R3, 2026-10-16).
 *
 *   node mysql/scripts/backfill-location-scope.js               # DRY-RUN: solo lee y lista
 *   node mysql/scripts/backfill-location-scope.js --all-roles   # incluye roles que no son por locación
 *   node mysql/scripts/backfill-location-scope.js --apply       # escribe (en una transacción)
 *
 * El problema: hay dos pantallas para asignar locaciones a un empleado. La
 * antigua escribe solo en Mongo (`companies.employees[].preference.managerLocation`);
 * la nueva, en SQL (`staff_location_access`). El servidor autoriza con SQL
 * (mysql/helpers/staffAccess.js), así que quien se asignó con la pantalla
 * antigua no tiene filas, y un rol por locación (niveles 6 y 7) sin filas es
 * fail-closed: no ve inventario.
 *
 * Por qué no sirve mysql/scripts/migrate-roles.js para esto:
 *   - buscaba la locación por nombre en TODA la base (dos compañías con una
 *     "Main Office" se cruzaban);
 *   - creaba un company_staff nuevo (UUID) con INSERT IGNORE: si ya existía, el
 *     insert se ignoraba y las filas de locación quedaban apuntando a un id que
 *     no existe;
 *   - descartaba en silencio lo que no resolvía.
 *
 * Este script:
 *   - usa el company_staff que YA existe (compañía SQL + staff_member por email);
 *   - resuelve la locación dentro de su compañía, sin distinguir mayúsculas ni
 *     espacios (como el import: "Almeria" y "almeria " son la misma);
 *   - por defecto solo toca roles por locación (6, 7): para el resto las filas
 *     no cambian nada (staffAccess las ignora). --all-roles los incluye;
 *   - no duplica ni sobrescribe filas existentes (si los permisos difieren, lo
 *     informa y deja la de SQL);
 *   - lista TODO lo que no resuelve, con el motivo.
 *
 * Mongo no guarda el id SQL de la compañía: el cruce de compañía es por nombre
 * (como migrate-roles), y las que no casan salen en el informe.
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });
const crypto = require('crypto');

const LOCATION_SCOPED_LEVELS = new Set([6, 7]);

const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Función pura: decide qué filas faltan y por qué no se pueden crear otras.
 *
 * @param {object} input
 * @param {Array<{company_name, employees:[{user, active, preference:{managerLocation:[{location, actions}]}}]}>} input.companies  Mongo
 * @param {Array<{company_id, company_name}>} input.sqlCompanies          company_info
 * @param {Array<{staff_id, email}>} input.staffMembers                   staff_member
 * @param {Array<{id, company_id, staff_id, is_active, role_level, role_type}>} input.companyStaff  company_staff JOIN roles
 * @param {Array<{location_id, company_id, location_name}>} input.locations
 * @param {Array<{company_staff_id, location_id, can_create, can_update, can_delete}>} input.existingAccess
 * @param {{ includeAllRoles?: boolean, newId?: () => string }} [opts]
 * @returns {{ inserts: object[], issues: object[], stats: object }}
 */
function planLocationScopeBackfill(input, { includeAllRoles = false, newId = () => crypto.randomUUID() } = {}) {
  const sqlCompanyByName = new Map();
  const duplicatedCompanyNames = new Set();
  for (const c of input.sqlCompanies) {
    const key = norm(c.company_name);
    if (sqlCompanyByName.has(key)) duplicatedCompanyNames.add(key);
    sqlCompanyByName.set(key, c.company_id);
  }
  const staffIdByEmail = new Map(input.staffMembers.map((s) => [norm(s.email), s.staff_id]));
  const companyStaffByKey = new Map(input.companyStaff.map((cs) => [`${cs.company_id}:${cs.staff_id}`, cs]));

  const locationsByCompanyAndName = new Map();
  for (const l of input.locations) {
    const key = `${l.company_id}:${norm(l.location_name)}`;
    if (!locationsByCompanyAndName.has(key)) locationsByCompanyAndName.set(key, []);
    locationsByCompanyAndName.get(key).push(l.location_id);
  }
  const existingByPair = new Map(
    input.existingAccess.map((a) => [`${a.company_staff_id}:${a.location_id}`, a]),
  );

  const inserts = [];
  const issues = [];
  const stats = { employeesWithMongoScope: 0, mongoLocations: 0, toInsert: 0, alreadyInSql: 0 };
  const plannedPairs = new Set();
  const issue = (reason, detail) => issues.push({ reason, ...detail });

  for (const company of input.companies) {
    const employees = (company.employees ?? []).filter(
      (e) => Array.isArray(e?.preference?.managerLocation) && e.preference.managerLocation.length > 0,
    );
    if (employees.length === 0) continue;

    const companyKey = norm(company.company_name);
    const sqlCompanyId = sqlCompanyByName.get(companyKey);
    if (sqlCompanyId === undefined) {
      for (const e of employees) issue('company_not_in_sql', { company: company.company_name, staff: e.user });
      stats.employeesWithMongoScope += employees.length;
      continue;
    }
    if (duplicatedCompanyNames.has(companyKey)) {
      for (const e of employees) issue('company_name_ambiguous_in_sql', { company: company.company_name, staff: e.user });
      stats.employeesWithMongoScope += employees.length;
      continue;
    }

    for (const emp of employees) {
      stats.employeesWithMongoScope += 1;
      stats.mongoLocations += emp.preference.managerLocation.length;
      const base = { company: company.company_name, company_id: sqlCompanyId, staff: emp.user };

      const staffId = staffIdByEmail.get(norm(emp.user));
      if (staffId === undefined) { issue('staff_not_in_staff_member', base); continue; }

      const cs = companyStaffByKey.get(`${sqlCompanyId}:${staffId}`);
      if (!cs) { issue('no_company_staff_row', { ...base, staff_id: staffId }); continue; }
      if (emp.active === false || Number(cs.is_active) === 0) {
        issue('inactive', { ...base, company_staff_id: cs.id });
        continue;
      }
      const role = `${cs.role_level} ${cs.role_type}`;
      if (!includeAllRoles && !LOCATION_SCOPED_LEVELS.has(Number(cs.role_level))) {
        issue('role_not_location_scoped', { ...base, role, locations: emp.preference.managerLocation.length });
        continue;
      }

      for (const loc of emp.preference.managerLocation) {
        const candidates = locationsByCompanyAndName.get(`${sqlCompanyId}:${norm(loc?.location)}`) ?? [];
        if (candidates.length === 0) { issue('location_not_in_sql', { ...base, role, location: loc?.location }); continue; }
        if (candidates.length > 1) {
          issue('location_name_ambiguous', { ...base, role, location: loc.location, location_ids: candidates.join(',') });
          continue;
        }
        const locationId = candidates[0];
        const pair = `${cs.id}:${locationId}`;
        const flags = {
          can_create: Boolean(loc.actions?.create),
          can_update: Boolean(loc.actions?.update),
          can_delete: Boolean(loc.actions?.delete),
        };
        const existing = existingByPair.get(pair);
        if (existing) {
          stats.alreadyInSql += 1;
          const differs = ['can_create', 'can_update', 'can_delete'].some((k) => Boolean(existing[k]) !== flags[k]);
          if (differs) issue('flags_differ_kept_sql', { ...base, role, location: loc.location, sql: existing, mongo: flags });
          continue;
        }
        if (plannedPairs.has(pair)) continue; // la misma locación repetida en Mongo
        plannedPairs.add(pair);
        inserts.push({
          id: newId(),
          company_staff_id: cs.id,
          location_id: locationId,
          ...flags,
          // Solo para el informe:
          _company: company.company_name,
          _staff: emp.user,
          _role: role,
          _location: loc.location,
        });
      }
    }
  }
  stats.toInsert = inserts.length;
  return { inserts, issues, stats };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const includeAllRoles = process.argv.includes('--all-roles');
  const mongoose = require('mongoose');
  const getConnection = require('../database/config');
  const sql = getConnection();

  const [[ident]] = await sql.query('SELECT DATABASE() AS db, @@hostname AS host');
  console.log('─'.repeat(72));
  console.log(`SQL   : ${ident.db} @ ${ident.host}`);
  await mongoose.connect(process.env.DB_CNN);
  console.log(`Mongo : ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log(`Modo  : ${apply ? 'APPLY (escribe)' : 'DRY-RUN (solo lectura)'}${includeAllRoles ? ' · todos los roles' : ' · solo roles 6/7'}`);
  console.log('─'.repeat(72));

  const companies = await mongoose.connection.db
    .collection('companies')
    .find(
      { 'employees.preference.managerLocation.0': { $exists: true } },
      { projection: { company_name: 1, 'employees.user': 1, 'employees.active': 1, 'employees.preference.managerLocation': 1 } },
    )
    .toArray();
  const [sqlCompanies] = await sql.query('SELECT company_id, company_name FROM company_info');
  const [staffMembers] = await sql.query('SELECT staff_id, email FROM staff_member');
  const [companyStaff] = await sql.query(
    `SELECT cs.id, cs.company_id, cs.staff_id, cs.is_active, r.role_level, r.role_type
       FROM company_staff cs JOIN roles r ON r.id = cs.role_id`,
  );
  const [locations] = await sql.query('SELECT location_id, company_id, location_name FROM locations');
  const [existingAccess] = await sql.query(
    'SELECT company_staff_id, location_id, can_create, can_update, can_delete FROM staff_location_access',
  );

  const { inserts, issues, stats } = planLocationScopeBackfill(
    { companies, sqlCompanies, staffMembers, companyStaff, locations, existingAccess },
    { includeAllRoles },
  );

  console.log('\nResumen');
  console.log(`  Compañías Mongo con alcance por locación : ${companies.length}`);
  console.log(`  Empleados con alcance en Mongo           : ${stats.employeesWithMongoScope}`);
  console.log(`  Locaciones asignadas en Mongo            : ${stats.mongoLocations}`);
  console.log(`  Ya estaban en SQL                        : ${stats.alreadyInSql}`);
  console.log(`  Filas a crear en staff_location_access   : ${stats.toInsert}`);

  if (inserts.length) {
    console.log('\nFilas a crear:');
    console.table(inserts.map((r) => ({
      company: r._company, staff: r._staff, role: r._role, location: r._location,
      location_id: r.location_id, create: r.can_create, update: r.can_update, delete: r.can_delete,
    })));
  }

  const byReason = issues.reduce((acc, i) => ({ ...acc, [i.reason]: (acc[i.reason] ?? 0) + 1 }), {});
  if (issues.length) {
    console.log('\nNo se crean (motivo → cantidad):');
    console.table(byReason);
    for (const reason of Object.keys(byReason)) {
      console.log(`\n· ${reason}`);
      console.table(issues.filter((i) => i.reason === reason).map(({ reason: _r, ...rest }) => ({
        ...rest,
        ...(rest.sql ? { sql: JSON.stringify(rest.sql), mongo: JSON.stringify(rest.mongo) } : {}),
      })));
    }
  }

  if (apply && inserts.length) {
    const conn = await sql.getConnection?.() ?? sql;
    try {
      await conn.beginTransaction?.();
      for (const r of inserts) {
        await conn.query(
          'INSERT INTO staff_location_access (id, company_staff_id, location_id, can_create, can_update, can_delete) VALUES (?,?,?,?,?,?)',
          [r.id, r.company_staff_id, r.location_id, r.can_create, r.can_update, r.can_delete],
        );
      }
      await conn.commit?.();
      console.log(`\n✓ ${inserts.length} filas creadas en staff_location_access.`);
    } catch (error) {
      await conn.rollback?.();
      console.error('\n✗ Falló; no se escribió nada (rollback):', error.message);
      process.exitCode = 1;
    } finally {
      conn.release?.();
    }
  } else {
    console.log(apply ? '\nNada que crear.' : '\n(dry-run — no se escribió nada; repetir con --apply para crear las filas)');
  }

  await mongoose.disconnect();
  await sql.end?.();
}

module.exports = { planLocationScopeBackfill, norm };

if (require.main === module) {
  main().catch((error) => {
    console.error('BACKFILL FAILED:', error.message);
    process.exit(1);
  });
}
