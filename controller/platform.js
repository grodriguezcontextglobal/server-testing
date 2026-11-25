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
  rangeDays,
  resolveCompany,
  companyIndex,
  inventoryRow,
  transactionRow,
  eventRow,
  activityRow,
  companyDetailBody,
} = require('../helpers/platformConsole');

const realDeps = () => ({
  Company: require('../models/Company'),
  CompanySubscription: require('../models/CompanySubscription'),
  StaffActivityLog: require('../models/StaffActivityLog'),
  AdminUser: require('../models/AdminUser'),
  Event: require('../models/Event'),
  Transaction: require('../models/Transaction'),
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
  //
  // El campo es `timestamp`, NO `createdAt`. models/StaffActivityLog.js no
  // declara `timestamps: true` y define su propia fecha. Con `$createdAt` el
  // `$max` salia null para TODAS las compañias desde el 2026-11-20, asi que
  // `lastActivityAt` iba nulo en la tabla de clientes y en el resumen: no daba
  // error, simplemente no casaba. Es el mismo fallo que el del asistente
  // (PR #110) y por eso el test de abajo compara contra el esquema real.
  const activity = await d.StaffActivityLog.aggregate([
    { $match: { company_id: { $ne: null } } },
    { $group: { _id: '$company_id', last: { $max: '$timestamp' } } },
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

// ─────────────────────────────────────────────────────────────────────────────
// DC3 — segunda tanda.
//
// Las cinco que el console llamaba y respondian 404: /inventory,
// /transactions, /events, /activity y /companies/:id. Cuelgan de la misma
// cadena del router (gate + auditoria), sin tocarla.
//
// `/attention` NO esta aqui a proposito. Promete "overdue devices, failed
// payments, trials ending and clients gone quiet", y de esas cuatro los
// equipos vencidos NO SE CALCULAN y los importes no estan guardados. Un cero
// en un panel que se llama "Needs attention" se lee como "todo bien", no como
// "esto no se mide". Entra cuando se decida que devuelve en lugar de un cero.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * id de Mongo <-> id de SQL <-> nombre, para una compañia.
 *
 * Existe aparte de `gatherCompanies` y no dentro: aquella devuelve FILAS para
 * pintar y esta devuelve el CRUCE, que es lo que necesita el inventario —donde
 * la clave es el `company_id` numerico de SQL y no el ObjectId—. Son tres
 * consultas que gatherCompanies ya hace; se repiten a cambio de no tocar una
 * funcion que ya esta en produccion y cubierta por tests.
 */
async function companyCrosswalk(d) {
  const [companies, subscriptions, sqlRows] = await Promise.all([
    d.Company.find({}).select('company_name').lean(),
    d.CompanySubscription.find({}).select('company sql_company_id').lean(),
    d.query('SELECT company_id, company_name FROM company_info').then(([rows]) => rows),
  ]);
  const sqlIdByName = new Map(sqlRows.map((r) => [String(r.company_name ?? ''), Number(r.company_id)]));
  const sqlIdByCompany = new Map(
    subscriptions.filter((s) => s.sql_company_id != null).map((s) => [String(s.company), Number(s.sql_company_id)])
  );
  return companies.map((c) => ({
    id: String(c._id),
    name: c.company_name || '',
    sqlId: sqlIdByCompany.get(String(c._id)) ?? sqlIdByName.get(String(c.company_name ?? '')) ?? null,
  }));
}

/** Lo que piden las cuatro listas: pagina, tope y, si la hay, compañia. */
const readListQuery = (query = {}) => ({
  ...readPaging(query),
  companyId: String(query.companyId || query.company || '').trim() || null,
  search: String(query.search || '').trim(),
});

const fail = (response, error) => response.status(500).json({ ok: false, msg: error.message });

/**
 * GET /api/platform/inventory?page=&limit=&search=&companyId=&status=
 *
 * Inventario de todos los clientes. El cruce con la compañia va por
 * `company_id` numerico, que es de fiar; el nombre solo se usa para resolver
 * el ObjectId de Mongo de cara al console.
 */
const platformInventory = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const { page, limit, companyId, search } = readListQuery(request.query || {});
    const crosswalk = await companyCrosswalk(d);
    const index = companyIndex(crosswalk);

    const where = [];
    const params = [];
    if (companyId) {
      const sqlId = crosswalk.find((c) => c.id === companyId)?.sqlId ?? null;
      // Una compañia que no cruza no tiene inventario que enseñar. `1=0` y no
      // "sin filtro": lo segundo devolveria el inventario de TODOS.
      if (sqlId === null) { where.push('1 = 0'); } else { where.push('i.company_id = ?'); params.push(sqlId); }
    }
    const status = String(request.query?.status || '').trim();
    if (status === 'out') where.push('i.warehouse = 0');
    if (status === 'in_warehouse') where.push('i.warehouse <> 0');
    if (search) {
      where.push('(i.serial_number LIKE ? OR i.item_group LIKE ? OR i.category_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await d.query(
      `SELECT COUNT(*) AS total FROM item_inv i ${clause}`, params
    );
    const [rows] = await d.query(
      'SELECT i.item_id, i.serial_number, i.item_group, i.category_name, i.location, ' +
        'i.warehouse, i.ownership, i.company_id, c.company_name ' +
        `FROM item_inv i LEFT JOIN company_info c ON c.company_id = i.company_id ${clause} ` +
        'ORDER BY i.item_id DESC LIMIT ? OFFSET ?',
      [...params, limit, (page - 1) * limit]
    );

    return response.status(200).json(
      listBody({
        rows: rows.map((row) => inventoryRow({ row, company: resolveCompany(row.company_name, index) })),
        page,
        limit,
        total: Number(total ?? 0),
      })
    );
  } catch (error) { return fail(response, error); }
};

/**
 * GET /api/platform/transactions?page=&limit=&companyId=
 *
 * `Transaction.company` se escribe sin validar, asi que puede llevar el id o
 * el nombre. El filtro acepta los dos y las filas que no resuelvan salen con
 * `companyId: null`, nunca atribuidas por parecido.
 */
const platformTransactions = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const { page, limit, companyId } = readListQuery(request.query || {});
    const crosswalk = await companyCrosswalk(d);
    const index = companyIndex(crosswalk);

    const filter = {};
    if (companyId) {
      const name = crosswalk.find((c) => c.id === companyId)?.name;
      filter.company = { $in: [companyId, ...(name ? [name] : [])] };
    }

    const [total, docs] = await Promise.all([
      d.Transaction.countDocuments(filter),
      d.Transaction.find(filter)
        // `created_at` es un numero (epoch) y `date` una cadena: ordenar por el
        // numero es lo unico que da "la mas nueva primero" de verdad.
        .sort({ created_at: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return response.status(200).json(
      listBody({
        rows: docs.map((doc) => transactionRow({ doc, company: resolveCompany(doc.company, index) })),
        page,
        limit,
        total,
      })
    );
  } catch (error) { return fail(response, error); }
};

/**
 * GET /api/platform/events?page=&limit=&companyId=&active=
 *
 * Se filtra por `company_id`, nunca por `company`: ese campo se escribe con el
 * nombre, con el id, con un proveedor o vacio segun el camino.
 */
const platformEvents = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const { page, limit, companyId } = readListQuery(request.query || {});
    const index = companyIndex(await companyCrosswalk(d));

    const filter = {};
    if (companyId) filter.company_id = companyId;
    const active = String(request.query?.active || '').trim();
    if (active === 'true') filter.active = true;
    if (active === 'false') filter.active = false;

    const [total, docs] = await Promise.all([
      d.Event.countDocuments(filter),
      // Las fechas del evento viven dentro de `eventInfoDetail`, que no tiene
      // esquema y por tanto no esta indexado. `_id` descendente da el orden de
      // creacion, que es el que el console quiere ("newest first").
      d.Event.find(filter).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    return response.status(200).json(
      listBody({
        rows: docs.map((doc) => eventRow({ doc, company: resolveCompany(doc.company_id, index) })),
        page,
        limit,
        total,
      })
    );
  } catch (error) { return fail(response, error); }
};

/**
 * GET /api/platform/activity?page=&limit=&companyId=&range=7d|30d|90d
 *
 * La fecha es `timestamp`. Ver el comentario de `gatherCompanies`.
 */
const platformActivity = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const { page, limit, companyId } = readListQuery(request.query || {});
    const index = companyIndex(await companyCrosswalk(d));

    const range = readRange(request.query?.range);
    const since = new Date(Date.now() - rangeDays(range) * 24 * 60 * 60 * 1000);
    const filter = { timestamp: { $gte: since } };
    if (companyId) filter.company_id = companyId;

    const [total, docs] = await Promise.all([
      d.StaffActivityLog.countDocuments(filter),
      d.StaffActivityLog.find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return response.status(200).json(
      listBody({
        rows: docs.map((doc) => activityRow({ doc, company: resolveCompany(doc.company_id, index) })),
        page,
        limit,
        total,
        filters: { range },
      })
    );
  } catch (error) { return fail(response, error); }
};

/**
 * GET /api/platform/companies/:id — la ficha de un cliente.
 *
 * Reutiliza la fila de la lista para que el estado no se calcule dos veces y
 * pueda salir distinto en dos pantallas.
 */
const platformCompanyDetail = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const id = String(request.params?.id || '');
    const row = (await gatherCompanies(d)).find((c) => c.id === id);
    if (!row) return response.status(404).json({ ok: false, msg: 'Company not found' });

    const subscription = await d.CompanySubscription.findOne({ company: id }).lean();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [events, transactions, activity30d] = await Promise.all([
      d.Event.countDocuments({ company_id: id }),
      d.Transaction.countDocuments({ company: { $in: [id, row.name] } }),
      d.StaffActivityLog.countDocuments({ company_id: id, timestamp: { $gte: since } }),
    ]);

    return response.status(200).json(
      companyDetailBody({ row, subscription, counts: { events, transactions, activity30d } })
    );
  } catch (error) { return fail(response, error); }
};

module.exports = {
  platformMe,
  platformCompanies,
  platformSummary,
  gatherCompanies,
  companyCrosswalk,
  platformInventory,
  platformTransactions,
  platformEvents,
  platformActivity,
  platformCompanyDetail,
};
