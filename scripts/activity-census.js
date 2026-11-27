'use strict';

/**
 * Censo de actividad: cuentas de staff y clientes (AC-2 · APP-2026-003/016).
 * SOLO LEE — ni una escritura.
 *
 *   node scripts/activity-census.js [--out censo.json]
 *
 * Responde las dos preguntas que el POA&M no podia responder con un numero:
 *
 *   1) De las cuentas activas SIN MFA, cuantas nunca han entrado —asi que nunca
 *      tuvieron ocasion de enrolarse— y cuantas si entraron y no la pusieron.
 *      La diferencia decide si el hallazgo es de cobertura de MFA (IA-2) o de
 *      cuentas que nadie usa (AC-2), que son dos planes distintos.
 *
 *   2) Que clientes tienen rastro de uso real —eventos, transacciones,
 *      consumidores, inventario, actividad— y cuales no tienen ninguno.
 *
 * LO QUE NO HACE: decidir. El nombre de una compañia no dice si es de prueba
 * (hay "BEGIN" con casi 3.000 aparatos) y una cuenta sin usar puede ser la de
 * alguien que empieza el lunes. Esto cuenta; la clasificacion la hace una
 * persona mirando los numeros.
 *
 * El JSON de `--out` lleva correos y nombres de clientes: va a `logs\evidence\`
 * y no se adjunta a ningun sitio sin depurar.
 */

const fs = require('node:fs');

// La MFA es obligatoria desde esta fecha (task_mfa_mandatory, desplegada
// 2026-10-05). Una cuenta cuyo ultimo acceso sea anterior NUNCA se encontro la
// pantalla de enrolamiento.
const MFA_MANDATORY_SINCE = new Date('2026-10-05T00:00:00Z');
const DORMANT_DAYS = 90;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
const daysSince = (d, now) => (d ? Math.floor((now - new Date(d)) / 86400000) : null);

// Correos que PARECEN de prueba. Heuristica para ordenar la revision, nunca un
// veredicto: nada se desactiva por casar con esto.
const TEST_LIKE = /^(qaz|wsx|edc|rfv|asd|zxc|test|testing|demo|prueba|aaa|abc|123)/i;
const TEST_DOMAIN = /@(test|example|qaz|wsx|demo)\./i;
const looksLikeTest = (email) => {
  const e = String(email || '').toLowerCase();
  return TEST_LIKE.test(e) || TEST_DOMAIN.test(e) || /^\d+@/.test(e);
};

// Lo mismo que exige el login: `mfaEnabled` Y un secreto guardado.
const hasMfa = (u) => Boolean(u.mfaEnabled && u.mfaSecret && u.mfaSecret.base32);

/**
 * En que grupo cae una cuenta. Pura, para poder probarla sin base de datos.
 */
const classifyStaff = ({ user, activityCount = 0, lastActivity = null, now }) => {
  const everLoggedIn =
    Boolean(user.lastLoginAt) || Number(user.loginCount || 0) > 0 || activityCount > 0;
  const loggedInSinceMfa =
    Boolean(user.lastLoginAt && new Date(user.lastLoginAt) >= MFA_MANDATORY_SINCE);
  const lastSeen = [user.lastLoginAt, lastActivity]
    .filter(Boolean)
    .map((d) => new Date(d))
    .sort((a, b) => b - a)
    .at(0) || null;

  if (user.active === false) return 'ya desactivada';
  if (!everLoggedIn) return 'nunca entro';
  // El mandato solo explica a quien NO tiene MFA. Una cuenta enrolada con el
  // login viejo no "deja de entrar por la MFA": esta dormida, y decir lo
  // contrario manda a revisar un control que esa persona ya cumplio.
  if (!hasMfa(user) && !loggedInSinceMfa) return 'no entra desde que MFA es obligatoria';
  if (!hasMfa(user)) return 'entro con MFA obligatoria y sin MFA';
  // Lo que cuenta son los dias desde que se le vio por ultima vez, y eso
  // incluye la actividad del audit trail: un login viejo con actividad de
  // ayer no son dias de inactividad.
  if (daysSince(lastSeen, now) > DORMANT_DAYS) return 'dormida >90d';
  return 'en uso';
};

/**
 * En que grupo cae un cliente. `footprint` es la suma de todo lo que deja
 * rastro; cero significa que no hay NADA suyo en el sistema.
 */
const classifyCompany = ({ footprint, lastActivity, staffEverUsed, now }) => {
  if (footprint === 0 && !staffEverUsed) return 'sin rastro de uso';
  if (footprint === 0) return 'solo cuentas, sin datos';
  if (lastActivity && daysSince(lastActivity, now) <= DORMANT_DAYS) return 'en uso';
  return 'con datos, sin actividad reciente';
};

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();
  const db = mongoose.connection.db;
  const sql = require('../mysql/database/config')();
  const now = new Date();

  // Directo a la coleccion: el modelo oculta mfaSecret, y sin el no se puede
  // distinguir "MFA activada" de "MFA a medio enrolar".
  const [users, companies, subscriptions] = await Promise.all([
    db.collection('adminusers').find({}).project({
      email: 1, active: 1, super_user: 1, mfaEnabled: 1, 'mfaSecret.base32': 1,
      mfaRecoveryCodes: 1, lastLoginAt: 1, loginCount: 1, lastFailedLoginAt: 1,
      deactivatedAt: 1, deactivatedReason: 1,
    }).toArray(),
    db.collection('companies').find({}).project({
      company_name: 1, 'employees.user': 1, 'employees.userId': 1,
      'employees.active': 1, offboardedAt: 1,
    }).toArray(),
    db.collection('companysubscriptions').find({})
      .project({ company: 1, plan: 1, status: 1, sql_company_id: 1 }).toArray(),
  ]);

  const [events, transactions, consumers, actByCompany, actByStaff] = await Promise.all([
    // `type: 'event'`, como en todo el console: la coleccion guarda mas cosas.
    db.collection('events').aggregate([
      { $match: { type: 'event' } },
      { $group: { _id: '$company_id', n: { $sum: 1 } } },
    ]).toArray(),
    db.collection('transactions').aggregate([
      { $group: { _id: '$company', n: { $sum: 1 } } },
    ]).toArray(),
    // Los consumidores no tienen company_id: cuelgan del evento. El campo que
    // si guarda la compañia es `User.company_providers`.
    db.collection('users').aggregate([
      { $unwind: '$company_providers' },
      { $group: { _id: '$company_providers', n: { $sum: 1 } } },
    ]).toArray(),
    // `timestamp`, NO `createdAt`: StaffActivityLog define su propia fecha y
    // con `$createdAt` esta agregacion devuelve null para todas (PR #110).
    db.collection('staffactivitylogs').aggregate([
      { $match: { company_id: { $ne: null } } },
      { $group: { _id: '$company_id', n: { $sum: 1 }, last: { $max: '$timestamp' } } },
    ]).toArray(),
    db.collection('staffactivitylogs').aggregate([
      { $match: { staff_member_id: { $ne: null } } },
      { $group: { _id: '$staff_member_id', n: { $sum: 1 }, last: { $max: '$timestamp' } } },
    ]).toArray(),
  ]);

  const [sqlCompanies] = await sql.query('SELECT company_id, company_name FROM company_info');
  const [deviceRows] = await sql.query(
    'SELECT company_id, COUNT(*) AS total FROM item_inv GROUP BY company_id'
  );

  const n = (rows) => new Map(rows.map((r) => [String(r._id), Number(r.n || 0)]));
  const eventsBy = n(events);
  const txBy = n(transactions);
  const consumersBy = n(consumers);
  const actBy = new Map(actByCompany.map((r) => [String(r._id), { n: Number(r.n || 0), last: r.last }]));
  const staffAct = new Map(actByStaff.map((r) => [String(r._id), { n: Number(r.n || 0), last: r.last }]));
  const devicesBySqlId = new Map(deviceRows.map((r) => [Number(r.company_id), Number(r.total || 0)]));
  const sqlIdByName = new Map(sqlCompanies.map((r) => [String(r.company_name ?? ''), Number(r.company_id)]));
  const subByCompany = new Map(subscriptions.map((s) => [String(s.company), s]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const userByEmail = new Map(users.map((u) => [String(u.email || '').toLowerCase(), u]));
  const memberAccount = (e) =>
    (e.userId && userById.get(String(e.userId))) || userByEmail.get(String(e.user || '').toLowerCase());

  const companiesOfUser = new Map();
  for (const c of companies) {
    for (const e of c.employees || []) {
      const u = memberAccount(e);
      if (!u) continue;
      const key = String(u._id);
      if (!companiesOfUser.has(key)) companiesOfUser.set(key, []);
      companiesOfUser.get(key).push(c.company_name);
    }
  }

  const staffRows = users
    .map((u) => {
      const act = staffAct.get(String(u._id)) || { n: 0, last: null };
      const lastSeen = [u.lastLoginAt, act.last]
        .filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a).at(0) || null;
      return {
        email: u.email,
        active: u.active !== false,
        super_user: Boolean(u.super_user),
        mfa: hasMfa(u),
        recovery_codes: (u.mfaRecoveryCodes || []).length,
        created: day(u._id.getTimestamp()),
        last_login: day(u.lastLoginAt),
        logins: Number(u.loginCount || 0),
        audit_rows: act.n,
        last_audit: day(act.last),
        days_idle: daysSince(lastSeen, now),
        companies: companiesOfUser.get(String(u._id)) || [],
        test_like: looksLikeTest(u.email),
        group: classifyStaff({ user: u, activityCount: act.n, lastActivity: act.last, now }),
      };
    })
    .sort((a, b) => (b.days_idle ?? 1e9) - (a.days_idle ?? 1e9));

  const companyRows = companies
    .map((c) => {
      const id = String(c._id);
      const sub = subByCompany.get(id);
      const sqlId = sub?.sql_company_id ?? sqlIdByName.get(String(c.company_name ?? '')) ?? null;
      // Sin cruce a SQL, el inventario es DESCONOCIDO y no cero.
      const devices = sqlId !== null ? (devicesBySqlId.get(Number(sqlId)) ?? 0) : null;
      const act = actBy.get(id) || { n: 0, last: null };
      // `Transaction.company` guarda unas veces el id y otras el nombre.
      const tx = (txBy.get(id) || 0) + (txBy.get(String(c.company_name || '')) || 0);
      const ev = eventsBy.get(id) || 0;
      const cons = consumersBy.get(id) || 0;
      const staffEverUsed = (c.employees || []).some((e) => {
        const u = memberAccount(e);
        return Boolean(u && (u.lastLoginAt || Number(u.loginCount || 0) > 0));
      });
      const footprint = ev + tx + cons + (devices || 0) + act.n;
      return {
        company: c.company_name,
        mongo_id: id,
        sql_id: sqlId,
        offboarded_at: day(c.offboardedAt),
        plan: sub?.plan ?? null,
        sub_status: sub?.status ?? null,
        employees: (c.employees || []).length,
        employees_active: (c.employees || []).filter((e) => e.active !== false).length,
        events: ev,
        transactions: tx,
        consumers: cons,
        devices,
        audit_rows: act.n,
        last_activity: day(act.last),
        days_idle: daysSince(act.last, now),
        staff_ever_used: staffEverUsed,
        footprint,
        group: classifyCompany({ footprint, lastActivity: act.last, staffEverUsed, now }),
      };
    })
    .sort((a, b) => a.footprint - b.footprint);

  const tally = (rows) =>
    rows.reduce((acc, r) => ({ ...acc, [r.group]: (acc[r.group] || 0) + 1 }), {});
  const activeStaff = staffRows.filter((r) => r.active);
  const noMfa = activeStaff.filter((r) => !r.mfa);

  const out = {
    generated_at: now.toISOString(),
    mfa_mandatory_since: MFA_MANDATORY_SINCE.toISOString().slice(0, 10),
    staff: {
      total: staffRows.length,
      active: activeStaff.length,
      inactive: staffRows.length - activeStaff.length,
      active_without_mfa: noMfa.length,
      // El desglose que decide el plan de APP-2026-003.
      active_without_mfa_never_logged_in: noMfa.filter((r) => r.group === 'nunca entro').length,
      active_without_mfa_not_since_mandate:
        noMfa.filter((r) => r.group === 'no entra desde que MFA es obligatoria').length,
      active_without_mfa_but_logged_in_since:
        noMfa.filter((r) => r.group === 'entro con MFA obligatoria y sin MFA').length,
      with_mfa_no_recovery_codes: activeStaff.filter((r) => r.mfa && !r.recovery_codes).length,
      test_like: activeStaff.filter((r) => r.test_like).length,
      by_group: tally(activeStaff),
      rows: staffRows,
    },
    companies: {
      total: companyRows.length,
      offboarded: companyRows.filter((r) => r.offboarded_at !== '-').length,
      by_group: tally(companyRows),
      rows: companyRows,
    },
  };

  const file = arg('--out');
  if (file) fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');

  console.log('=== STAFF ===');
  console.log(JSON.stringify({ ...out.staff, rows: undefined }, null, 2));
  console.log('\n=== CLIENTES ===');
  console.log(JSON.stringify({ ...out.companies, rows: undefined }, null, 2));
  console.log('\ngrupo | eventos | trans | consum | equipos | audit | ult.act | staff | nombre');
  for (const r of companyRows) {
    console.log(
      [r.group.padEnd(32), String(r.events).padStart(4), String(r.transactions).padStart(5),
        String(r.consumers).padStart(5), String(r.devices ?? '?').padStart(6),
        String(r.audit_rows).padStart(5), r.last_activity.padEnd(11),
        `${r.employees_active}/${r.employees}`.padStart(6), r.company].join(' | ')
    );
  }
  if (file) console.log(`\nDetalle completo (lleva correos y nombres de clientes) en ${file}`);

  await mongoose.disconnect();
  try { await sql.end(); } catch { /* el pool puede no exponer end() */ }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { classifyStaff, classifyCompany, hasMfa, looksLikeTest, MFA_MANDATORY_SINCE };
