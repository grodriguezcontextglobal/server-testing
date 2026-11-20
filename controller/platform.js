'use strict';

const { PLATFORM_DOMAIN } = require('../helpers/platformAccess');

/**
 * Console de plataforma — esqueleto (M1).
 *
 * Aqui solo vive `GET /api/platform/me`. Las 20 rutas de lectura del console
 * son DC3 y se construyen encima de esta misma cadena, sin tocarla.
 *
 * Todas las respuestas de `/api/platform/*` usan la forma que pidio el
 * dashboard: `{ ok, data, page, limit, total }`, dinero en centimos enteros,
 * fechas en ISO UTC. `/me` no pagina, asi que lleva `ok` y `data` y nada mas.
 */

/**
 * Quien soy y que puedo ver.
 *
 * Que llegue aqui ya significa que `requirePlatformConsole` dijo que si, asi que
 * `platformAccess` es true por construccion: esta ruta NO vuelve a evaluar, solo
 * cuenta lo que el gate acaba de decidir. El valor de tenerla es que el console
 * pueda confirmar su acceso contra el servidor en vez de deducirlo del login
 * —que es lo que hace hoy—, y que ese chequeo deje su propia fila de auditoria.
 *
 * Deliberadamente no devuelve ni `super_user` ni roles de compañia: el console
 * es de solo lectura de plataforma y no tiene por que saber nada del poder de
 * escritura de la cuenta.
 */
const platformMe = async (request, response) => {
  return response.status(200).json({
    ok: true,
    data: {
      uid: request.platformActor?.id || request.uid,
      email: request.platformActor?.email || null,
      platformAccess: true,
      domain: PLATFORM_DOMAIN,
      // El gate exige las dos, asi que son true por haber llegado hasta aqui.
      // Se devuelven explicitas para que la pantalla no tenga que recordarlo.
      platformObserver: true,
      mfaEnabled: true,
      checkedAt: new Date().toISOString(),
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// DC3 — primeras dos rutas de lectura.
//
// Son estas dos y no otras porque el dashboard dijo cuales cablearia primero:
// "when /summary and /companies become real we flip the mock flag to false and
// wire those two first". El resto cuelga de la misma cadena, sin tocarla.
//
// LAS DEPENDENCIAS SE INYECTAN (el argumento `deps`) para poder probar las
// rutas enteras sin Mongo ni MySQL. Es el mismo patron de helpers/planLimits.js.
// ─────────────────────────────────────────────────────────────────────────────

const {
  readPaging,
  listBody,
  readRange,
  companyRow,
  filterCompanies,
  sortCompanies,
  pageOf,
  summaryBody,
} = require('../helpers/platformConsole');

const realDeps = () => ({
  Company: require('../models/Company'),
  CompanySubscription: require('../models/CompanySubscription'),
  StaffActivityLog: require('../models/StaffActivityLog'),
  AdminUser: require('../models/AdminUser'),
  Event: require('../models/Event'),
  query: (sql, params) => require('../mysql/database/config')().query(sql, params),
});

const withDeps = (deps) => ({ ...realDeps(), ...(deps || {}) });

/**
 * Todo lo que hace falta para construir una fila de cliente, en CUATRO
 * consultas para TODAS las compañias — no cuatro por compañia.
 *
 * El cruce Mongo->SQL sigue siendo por nombre (helpers/planLimits.js:123). La
 * auditoria del 2026-11-20 dice que hoy resuelven las 21 de 21, asi que se usa;
 * pero una compañia que no cruce se queda con los conteos de inventario en
 * `null` —desconocido— y NO en 0, que seria afirmar que no tiene aparatos.
 */
async function gatherCompanies(d) {
  const [companies, subscriptions, sqlRows] = await Promise.all([
    d.Company.find({}).select('company_name owner main_email employees.active').lean(),
    d.CompanySubscription.find({}).select('company plan status sql_company_id').lean(),
    d.query('SELECT company_id, company_name FROM company_info').then(([rows]) => rows),
  ]);

  const [deviceRows] = await d.query(
    'SELECT company_id, COUNT(*) AS total, SUM(warehouse = 0) AS out_now ' +
      'FROM item_inv GROUP BY company_id'
  );
  const devicesBySqlId = new Map(
    deviceRows.map((r) => [
      Number(r.company_id),
      { deviceCount: Number(r.total ?? 0), devicesOut: Number(r.out_now ?? 0) },
    ])
  );

  const sqlIdByName = new Map(sqlRows.map((r) => [String(r.company_name ?? ''), Number(r.company_id)]));
  const subscriptionByCompany = new Map(
    subscriptions.map((s) => [String(s.company), s])
  );

  // Ultima actividad por compañia, en una sola agregacion.
  const activity = await d.StaffActivityLog.aggregate([
    { $match: { company_id: { $ne: null } } },
    { $group: { _id: '$company_id', last: { $max: '$createdAt' } } },
  ]);
  const lastActivityByCompany = new Map(activity.map((a) => [String(a._id), a.last]));

  return companies.map((company) => {
    const subscription = subscriptionByCompany.get(String(company._id));
    const sqlId =
      subscription?.sql_company_id ?? sqlIdByName.get(String(company.company_name ?? '')) ?? null;
    const counts = sqlId !== null ? devicesBySqlId.get(Number(sqlId)) : null;
    return companyRow({
      company,
      // Sin cruce, desconocido. Sin fila de inventario pero con cruce, cero:
      // la compañia existe en SQL y no tiene aparatos, que es un dato.
      counts: counts ?? (sqlId !== null ? { deviceCount: 0, devicesOut: 0 } : {}),
      subscription,
      lastActivityAt: lastActivityByCompany.get(String(company._id)),
    });
  });
}

/**
 * GET /api/platform/companies?search=&status=&plan=&page=&limit=
 *
 * Una fila por cliente, con los nombres de campo que su tabla ya espera.
 */
const platformCompanies = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const rows = sortCompanies(filterCompanies(await gatherCompanies(d), request.query || {}));
    const { page, limit } = readPaging(request.query || {});
    return response.status(200).json(
      listBody({ rows: pageOf(rows, { page, limit }), page, limit, total: rows.length })
    );
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

/**
 * GET /api/platform/summary?range=7d|30d|90d
 *
 * Conteos de toda la plataforma. NO nombra a ningun cliente: es la unica
 * pantalla del console que se puede dejar abierta en un monitor compartido.
 */
const platformSummary = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const companies = await gatherCompanies(d);
    const [liveEvents, staffTotal, staffWithMfa] = await Promise.all([
      d.Event.countDocuments({ active: true }),
      d.AdminUser.countDocuments({ active: { $ne: false } }),
      d.AdminUser.countDocuments({ active: { $ne: false }, mfaEnabled: true }),
    ]);

    const sum = (field) =>
      companies.reduce((n, c) => (c[field] === null ? n : n + Number(c[field] || 0)), 0);

    return response.status(200).json(
      summaryBody({
        range: readRange(request.query?.range),
        companies,
        events: { live: liveEvents },
        devices: { out: sum('devicesOut'), overdue: null },
        staff: { total: staffTotal, withMfa: staffWithMfa },
      })
    );
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  platformMe,
  platformCompanies,
  platformSummary,
  gatherCompanies,
};
