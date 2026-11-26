'use strict';

const { PLATFORM_DOMAIN } = require('../helpers/platformAccess');
const { respondError } = require("../helpers/errorResponder");

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
  INVENTORY_STATUS,
  EVENT_TYPE,
  EVENT_STATUS,
  filterSupport,
  inventoryRow,
  transactionRow,
  eventRow,
  activityRow,
  companyDetailBody,
  activityCategory,
  ACTIVITY_CATEGORY,
  eventStatus,
  createdAtFromId,
  iso,
  MAX_LIMIT,
  ATTENTION_SUBSCRIPTION_STATUSES,
  attentionConditions,
  attentionRow,
} = require('../helpers/platformConsole');
const {
  companyActivityRow,
  companyTransactionRow,
  companyEventRow,
  companyInventoryRow,
  memberRow,
  consumerRow,
  staffRow,
  subscriptionBody,
  MERCHANT_NOT_SERVED,
} = require('../helpers/platformCompanyTabs');
const { effectiveLimits } = require('../helpers/planLimits');

const realDeps = () => ({
  Company: require('../models/Company'),
  CompanySubscription: require('../models/CompanySubscription'),
  StaffActivityLog: require('../models/StaffActivityLog'),
  AdminUser: require('../models/AdminUser'),
  Event: require('../models/Event'),
  Transaction: require('../models/Transaction'),
  // `consumer_info` NO tiene company_id —los consumidores cuelgan del evento—
  // asi que contarlos por cliente se hace por `User.company_providers`, que es
  // el campo que si guarda el id de la compañia.
  User: require('../models/User'),
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
    return respondError(request, response, error);
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
      // `type` ademas de `active`: sin el, el contador de la portada suma
      // documentos que no son eventos de cliente. Ver EVENT_TYPE.
      d.Event.countDocuments({ type: EVENT_TYPE, active: true }),
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
    return respondError(request, response, error);
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

// El respondedor comun, con la firma local de este controlador (SI-11).
const fail = (request, response, error) => respondError(request, response, error);

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
    // El console filtra por available|assigned|lost|in_repair. `item_inv` solo
    // sabe de `warehouse`, asi que sostiene los dos primeros; los otros dos se
    // DECLARAN como no medidos en `filters` y no se traducen a un WHERE que
    // devolveria cero y se leeria como "no hay ninguno perdido".
    const status = String(request.query?.status || '').trim();
    if (status === 'available') where.push('i.warehouse <> 0');
    if (status === 'assigned') where.push('i.warehouse = 0');
    if (search) {
      where.push('(i.serial_number LIKE ? OR i.item_group LIKE ? OR i.category_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Los totales se calculan SIN la clausula de estado, para que las cifras
    // de cabecera no cambien al pulsar un filtro: son el reparto del conjunto,
    // no de la vista.
    const baseWhere = where.filter((w) => !/warehouse/.test(w));
    const baseClause = baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : '';
    // `params` vale para las dos clausulas: el filtro de estado se escribe
    // entero en el SQL (`i.warehouse = 0`) y no aporta ningun placeholder.

    const [[{ total }]] = await d.query(
      `SELECT COUNT(*) AS total FROM item_inv i ${clause}`, params
    );
    const [[breakdown]] = await d.query(
      'SELECT COUNT(*) AS total, SUM(i.warehouse <> 0) AS available, ' +
        `SUM(i.warehouse = 0) AS assigned FROM item_inv i ${baseClause}`,
      params
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
        totals: {
          total: Number(breakdown?.total ?? 0),
          available: Number(breakdown?.available ?? 0),
          assigned: Number(breakdown?.assigned ?? 0),
          // No es cero: es que no se lleva. Un cero aqui diria que no hay
          // ningun equipo perdido, que es una frase que nadie ha comprobado.
          lost: null,
        },
        filters: { status: filterSupport(INVENTORY_STATUS, status || null) },
      })
    );
  } catch (error) { return fail(request, response, error); }
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
    // `type` es una cadena guardada sin validar, asi que se compara tal cual.
    // El vocabulario que el console ofrece (deposit|rental|sale|refund) NO
    // esta verificado contra lo que hay en la coleccion: si una pantalla
    // filtra y sale vacia, eso es lo primero que hay que mirar.
    const type = String(request.query?.type || '').trim();
    if (type) filter.type = type;

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
        totals: {
          count: total,
          // Dinero. No esta guardado en ninguno de los dos modelos.
          volumeCents: null,
          refundsCents: null,
          // Saldria de StripeWebhookEvent, que registra el evento pero no el
          // importe. Hasta entonces, null y no 0.
          failed: null,
        },
      })
    );
  } catch (error) { return fail(request, response, error); }
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

    // Solo eventos. Ver EVENT_TYPE en helpers/platformConsole.js: la coleccion
    // guarda mas de una cosa y el resto del servidor ya la acota asi.
    const filter = { type: EVENT_TYPE };
    if (companyId) filter.company_id = companyId;

    // El console filtra por live|upcoming|closed. `upcoming` sale de
    // `eventInfoDetail.dateBegin`, que vive en un objeto sin esquema y por
    // tanto sin indice: ofrecerlo como filtro seria un barrido por pulsacion.
    // Se CALCULA en cada fila, que es barato, y se declara no filtrable.
    const status = String(request.query?.status || request.query?.active || '').trim();
    if (status === 'live' || status === 'true') filter.active = true;
    if (status === 'closed' || status === 'false') filter.active = false;

    const [total, docs, live] = await Promise.all([
      d.Event.countDocuments(filter),
      // Las fechas del evento viven dentro de `eventInfoDetail`, que no tiene
      // esquema y por tanto no esta indexado. `_id` descendente da el orden de
      // creacion, que es el que el console quiere ("newest first").
      d.Event.find(filter).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      d.Event.countDocuments({ ...filter, active: true }),
    ]);

    return response.status(200).json(
      listBody({
        rows: docs.map((doc) => eventRow({ doc, company: resolveCompany(doc.company_id, index) })),
        page,
        limit,
        total,
        totals: {
          live,
          // Contarlos exigiria recorrer la coleccion entera leyendo una fecha
          // sin indice. Null hasta que `dateBegin` salga de `eventInfoDetail`.
          upcoming: null,
          devicesNotReturned: null,
          revenueCents: null,
        },
        filters: { status: filterSupport(EVENT_STATUS, status || null) },
      })
    );
  } catch (error) { return fail(request, response, error); }
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
  } catch (error) { return fail(request, response, error); }
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

    const sqlId = (await companyCrosswalk(d)).find((c) => c.id === id)?.sqlId ?? null;

    const [company, eventsActive, consumersCount, memberRows] = await Promise.all([
      d.Company.findOne({ _id: id }).select('phone').lean(),
      d.Event.countDocuments({ type: EVENT_TYPE, company_id: id, active: true }),
      // Por `company_providers`, que guarda el id de la compañia. `consumer_info`
      // en SQL no tiene columna de compañia: los consumidores cuelgan del evento.
      d.User.countDocuments({ company_providers: id }),
      // Sin cruce a SQL no hay alumnos que contar, y cero seria afirmar que no
      // los tiene. `null` dice lo que pasa: no lo sabemos.
      sqlId === null
        ? Promise.resolve(null)
        : d.query('SELECT COUNT(*) AS total FROM members_info WHERE company_id = ?', [sqlId])
            .then(([rows]) => Number(rows?.[0]?.total ?? 0)),
    ]);

    return response.status(200).json(
      companyDetailBody({
        row,
        company,
        sqlId,
        counts: { eventsActive, membersCount: memberRows, consumersCount },
      })
    );
  } catch (error) { return fail(request, response, error); }
};

/**
 * GET /api/platform/attention?limit=
 *
 * Los clientes que necesitan una mirada, y —esto es lo importante— QUE
 * condiciones se estan midiendo para decirlo. Ver attentionConditions en
 * helpers/platformConsole.js: de las tres que el console pide, hoy solo la
 * suscripcion tiene dato detras.
 *
 * Se sirve sobre las filas que `gatherCompanies` ya construye, asi que no
 * añade ni una consulta por encima de lo que cuesta `/companies`.
 *
 * `now` se puede inyectar para que la condicion que se enciende el 2026-12-09
 * se pueda probar antes de esa fecha, en vez de confiar en que alguien se
 * acuerde de mirarla ese dia.
 */
const platformAttention = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const now = d.now ? new Date(d.now) : new Date();
    const conditions = attentionConditions(now);
    const limit = Math.min(Number(request.query?.limit) || 100, MAX_LIMIT);

    const companies = await gatherCompanies(d);

    // Estado CRUDO de la suscripcion, no el `status` ya calculado de la fila:
    // ese mezcla la suscripcion con los equipos vencidos, y aqui hace falta
    // saber cual de las dos cosas puso al cliente en la lista.
    const subs = await d.CompanySubscription.find({})
      .select('company status')
      .lean();
    const statusByCompany = new Map(
      (subs || []).map((s) => [String(s.company), String(s.status || '').toLowerCase()])
    );

    const rows = [];
    for (const company of companies) {
      const status = statusByCompany.get(String(company.id));
      if (status && ATTENTION_SUBSCRIPTION_STATUSES.includes(status)) {
        rows.push(attentionRow({ kind: 'subscription', company, reason: `subscription is ${status}` }));
      }
    }

    // La tercera condicion, cuando el dato tenga edad para sostenerla.
    if (conditions.staffDormant.active) {
      const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const dormant = await d.StaffActivityLog.distinct('company_id', { timestamp: { $gte: since } });
      const recent = new Set((dormant || []).map(String));
      for (const company of companies) {
        if (!recent.has(String(company.id))) {
          rows.push(attentionRow({
            kind: 'staff_dormant',
            company,
            reason: 'no staff activity in 30 days',
          }));
        }
      }
    }

    return response.status(200).json(
      listBody({
        rows: rows.slice(0, limit),
        page: 1,
        limit,
        total: rows.length,
        // Quien mira la pantalla tiene que poder ver que no la esta viendo
        // entera. Una lista vacia con `devicesOverdue.active: false` dice algo
        // muy distinto de una lista vacia a secas.
        conditions,
      })
    );
  } catch (error) { return fail(request, response, error); }
};

// ════════════════════════ LAS NUEVE PESTAÑAS DE LA FICHA ════════════════════
//
// GET /api/platform/companies/:id/<recurso>. Cada una se registra como su
// propia ruta —no `/:id/:resource`— para que un recurso que no servimos de
// 404 de verdad y el console pueda distinguir "no existe" de "existe y no
// tiene datos". Es la diferencia que les costo cinco dias con lastActivityAt.

/**
 * Resuelve el cliente una sola vez para cualquier pestaña.
 *
 * Devuelve `null` cuando el id no existe, y la ficha contesta 404 — la misma
 * respuesta que daba antes de que estas rutas existieran, que es la correcta
 * para un cliente que no esta.
 */
const resolveTabCompany = async (d, id) => {
  const crosswalk = await companyCrosswalk(d);
  const hit = crosswalk.find((c) => c.id === id);
  if (!hit) return null;
  return { id, name: hit.name || null, sqlId: hit.sqlId ?? null };
};

const notFound = (response) =>
  response.status(404).json({ ok: false, msg: 'Company not found' });

/** De categoria del console a los `target_model` que caen en ella. */
const MODELS_BY_CATEGORY = Object.entries(ACTIVITY_CATEGORY).reduce((acc, [model, cat]) => {
  (acc[cat] = acc[cat] || []).push(model);
  return acc;
}, {});

/**
 * GET /companies/:id/activity?page=&limit=&category=
 *
 * `category` no es un campo guardado: se deriva de `target_model`, que es
 * texto libre. Filtrar por categoria se traduce a un `$in` de los modelos que
 * caen en ella; una categoria desconocida NO se ignora en silencio, se declara
 * en `filters` y la lista sale sin filtrar.
 */
const platformCompanyActivity = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const id = String(request.params?.id || '');
    const company = await resolveTabCompany(d, id);
    if (!company) return notFound(response);

    const { page, limit } = readListQuery(request.query || {});
    const category = String(request.query?.category || '').trim();
    const models = category ? MODELS_BY_CATEGORY[category] : null;

    const filter = { company_id: id };
    if (models) filter.target_model = { $in: models };

    const [total, docs] = await Promise.all([
      d.StaffActivityLog.countDocuments(filter),
      // `timestamp`, NO `createdAt`: este modelo define el suyo.
      d.StaffActivityLog.find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return response.status(200).json(
      listBody({
        rows: docs.map((doc) =>
          companyActivityRow({ doc, category: activityCategory(doc.target_model) })
        ),
        page,
        limit,
        total,
        filters: {
          category: {
            supported: Object.keys(MODELS_BY_CATEGORY),
            applied: models ? category : null,
            ...(category && !models ? { note: `"${category}" no es una categoria conocida` } : {}),
          },
        },
      })
    );
  } catch (error) { return fail(request, response, error); }
};

/**
 * GET /companies/:id/transactions?page=&limit=
 *
 * `Transaction.company` se escribe con el id o con el nombre segun el camino,
 * asi que se buscan los dos. Lleva el correo del consumidor, que la lista
 * entre clientes no lleva.
 */
const platformCompanyTransactions = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const id = String(request.params?.id || '');
    const company = await resolveTabCompany(d, id);
    if (!company) return notFound(response);

    const { page, limit } = readListQuery(request.query || {});
    const filter = { company: { $in: [id, ...(company.name ? [company.name] : [])] } };

    const [total, docs] = await Promise.all([
      d.Transaction.countDocuments(filter),
      d.Transaction.find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return response.status(200).json(
      listBody({
        rows: docs.map((doc) => companyTransactionRow({ doc })),
        page,
        limit,
        total,
        totals: {
          count: total,
          // Dinero: no esta guardado en ninguno de los dos modelos.
          volumeCents: null,
          refundsCents: null,
        },
      })
    );
  } catch (error) { return fail(request, response, error); }
};

/**
 * GET /companies/:id/events?page=&limit=
 *
 * `type: 'event'` como en todas partes. `consumersCount` sale de
 * `User.event_providers`, que guarda ids de evento —NO de `eventSelected`,
 * que guarda nombres— y se cuenta para TODA la pagina en una agregacion, no
 * una consulta por fila.
 */
const platformCompanyEvents = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const id = String(request.params?.id || '');
    const company = await resolveTabCompany(d, id);
    if (!company) return notFound(response);

    const { page, limit } = readListQuery(request.query || {});
    const filter = { type: EVENT_TYPE, company_id: id };

    const [total, docs] = await Promise.all([
      d.Event.countDocuments(filter),
      d.Event.find(filter).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    const ids = docs.map((doc) => String(doc._id));
    const counts = new Map();
    if (ids.length) {
      const grouped = await d.User.aggregate([
        { $match: { event_providers: { $in: ids } } },
        { $unwind: '$event_providers' },
        { $match: { event_providers: { $in: ids } } },
        { $group: { _id: '$event_providers', n: { $sum: 1 } } },
      ]);
      for (const row of grouped || []) counts.set(String(row._id), Number(row.n || 0));
    }

    return response.status(200).json(
      listBody({
        rows: docs.map((doc) =>
          companyEventRow({
            doc,
            status: eventStatus({
              active: Boolean(doc.active),
              startsAt: iso(doc.eventInfoDetail?.dateBegin),
            }),
            consumersCount: counts.get(String(doc._id)) ?? 0,
          })
        ),
        page,
        limit,
        total,
      })
    );
  } catch (error) { return fail(request, response, error); }
};

/**
 * GET /companies/:id/inventory?page=&limit=
 *
 * Agrupado por modelo, que es como lo lee esta pestaña. Un cliente sin cruce a
 * SQL no tiene inventario que enseñar: lista vacia con `total: 0`, y NO el
 * inventario de todos, que es lo que pasaria si se quitara el filtro.
 */
const platformCompanyInventory = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const id = String(request.params?.id || '');
    const company = await resolveTabCompany(d, id);
    if (!company) return notFound(response);

    const { page, limit } = readListQuery(request.query || {});
    if (company.sqlId === null) {
      return response.status(200).json(
        listBody({ rows: [], page, limit, total: 0, totals: { total: 0, available: 0, out: 0, lost: null } })
      );
    }

    const [[counted]] = await d.query(
      'SELECT COUNT(DISTINCT i.item_group, i.category_name, i.location) AS groups, ' +
        'COUNT(*) AS total, SUM(i.warehouse <> 0) AS available, SUM(i.warehouse = 0) AS out_now ' +
        'FROM item_inv i WHERE i.company_id = ?',
      [company.sqlId]
    );
    const [rows] = await d.query(
      'SELECT i.item_group, i.category_name, i.location, COUNT(*) AS total, ' +
        'SUM(i.warehouse <> 0) AS available, SUM(i.warehouse = 0) AS out_now, ' +
        // Texto, no numero: los seriales llevan un contador al final.
        'MIN(i.serial_number) AS serial_min, MAX(i.serial_number) AS serial_max ' +
        'FROM item_inv i WHERE i.company_id = ? ' +
        'GROUP BY i.item_group, i.category_name, i.location ' +
        'ORDER BY total DESC, i.item_group ASC LIMIT ? OFFSET ?',
      [company.sqlId, limit, (page - 1) * limit]
    );

    return response.status(200).json(
      listBody({
        rows: rows.map((row) => companyInventoryRow({ row })),
        page,
        limit,
        total: Number(counted?.groups ?? 0),
        totals: {
          total: Number(counted?.total ?? 0),
          available: Number(counted?.available ?? 0),
          out: Number(counted?.out_now ?? 0),
          lost: null,
        },
      })
    );
  } catch (error) { return fail(request, response, error); }
};

/**
 * GET /companies/:id/members?page=&limit=&search=
 *
 * Alumnos, desde `members_info`. Sin cruce a SQL no hay alumnos que contar.
 */
const platformCompanyMembers = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const id = String(request.params?.id || '');
    const company = await resolveTabCompany(d, id);
    if (!company) return notFound(response);

    const { page, limit, search } = readListQuery(request.query || {});
    if (company.sqlId === null) {
      return response.status(200).json(listBody({ rows: [], page, limit, total: 0 }));
    }

    const where = ['m.company_id = ?'];
    const params = [company.sqlId];
    if (search) {
      where.push('(m.first_name LIKE ? OR m.last_name LIKE ? OR m.email LIKE ? OR m.external_id LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const clause = `WHERE ${where.join(' AND ')}`;

    const [[{ total }]] = await d.query(
      `SELECT COUNT(*) AS total FROM members_info m ${clause}`, params
    );
    const [rows] = await d.query(
      'SELECT m.member_id, m.external_id, m.first_name, m.last_name, m.email ' +
        `FROM members_info m ${clause} ORDER BY m.member_id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );

    return response.status(200).json(
      listBody({ rows: rows.map((row) => memberRow({ row })), page, limit, total: Number(total ?? 0) })
    );
  } catch (error) { return fail(request, response, error); }
};

/**
 * GET /companies/:id/consumers?page=&limit=&search=
 *
 * Por `User.company_providers`, NO por `consumer_info`: esa tabla SQL no tiene
 * columna de compañia. `transactionsCount` se cuenta para toda la pagina de
 * una vez, agrupando por correo, que es lo unico que las dos colecciones
 * comparten.
 */
const platformCompanyConsumers = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const id = String(request.params?.id || '');
    const company = await resolveTabCompany(d, id);
    if (!company) return notFound(response);

    const { page, limit, search } = readListQuery(request.query || {});
    const filter = { company_providers: id };
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { lastName: { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
      ];
    }

    const [total, docs] = await Promise.all([
      d.User.countDocuments(filter),
      d.User.find(filter).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    const emails = docs.map((doc) => doc.email).filter(Boolean);
    const byEmail = new Map();
    if (emails.length) {
      const grouped = await d.Transaction.aggregate([
        { $match: { 'consumerInfo.email': { $in: emails }, company: { $in: [id, ...(company.name ? [company.name] : [])] } } },
        { $group: { _id: '$consumerInfo.email', n: { $sum: 1 } } },
      ]);
      for (const row of grouped || []) byEmail.set(String(row._id), Number(row.n || 0));
    }

    return response.status(200).json(
      listBody({
        rows: docs.map((doc) =>
          consumerRow({ doc, transactionsCount: doc.email ? byEmail.get(doc.email) ?? 0 : null })
        ),
        page,
        limit,
        total,
      })
    );
  } catch (error) { return fail(request, response, error); }
};

/**
 * GET /companies/:id/staff?page=&limit=
 *
 * El equipo vive en `Company.employees[]`; MFA y ultimo acceso viven en
 * `AdminUser`. Se cruzan por correo. Un empleado sin cuenta sale con esos dos
 * campos a null: no ha entrado nunca porque no puede.
 *
 * La paginacion se hace en memoria A PROPOSITO: `employees` es un array dentro
 * del documento de la compañia, asi que ya esta entero en memoria en cuanto se
 * lee la compañia. Paginarlo en Mongo costaria mas que recortarlo aqui.
 */
const platformCompanyStaff = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const id = String(request.params?.id || '');
    const company = await resolveTabCompany(d, id);
    if (!company) return notFound(response);

    const { page, limit } = readListQuery(request.query || {});
    const doc = await d.Company.findOne({ _id: id }).select('employees').lean();
    const employees = Array.isArray(doc?.employees) ? doc.employees : [];
    const slice = employees.slice((page - 1) * limit, (page - 1) * limit + limit);

    const emails = slice.map((e) => e.email).filter(Boolean);
    const accounts = emails.length
      ? await d.AdminUser.find({ email: { $in: emails } })
          .select('email mfaEnabled lastLoginAt')
          .lean()
      : [];
    const byEmail = new Map(accounts.map((a) => [String(a.email), a]));

    // Acciones de los ultimos 30 dias, por cuenta, en una sola agregacion.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ids = accounts.map((a) => a._id).filter(Boolean);
    const actions = new Map();
    if (ids.length) {
      const grouped = await d.StaffActivityLog.aggregate([
        { $match: { company_id: id, staff_member_id: { $in: ids }, timestamp: { $gte: since } } },
        { $group: { _id: '$staff_member_id', n: { $sum: 1 } } },
      ]);
      for (const row of grouped || []) actions.set(String(row._id), Number(row.n || 0));
    }

    return response.status(200).json(
      listBody({
        rows: slice.map((employee) => {
          const account = employee.email ? byEmail.get(String(employee.email)) || null : null;
          return staffRow({
            employee,
            account,
            actions30d: account ? actions.get(String(account._id)) ?? 0 : null,
          });
        }),
        page,
        limit,
        total: employees.length,
      })
    );
  } catch (error) { return fail(request, response, error); }
};

/**
 * GET /companies/:id/subscription
 *
 * Registro, no lista. Un cliente sin documento de suscripcion no es un error:
 * esta en el plan gratuito, que es donde estan todos hoy.
 */
const platformCompanySubscription = (deps) => async (request, response) => {
  const d = withDeps(deps);
  try {
    const id = String(request.params?.id || '');
    const company = await resolveTabCompany(d, id);
    if (!company) return notFound(response);

    const [doc, companyDoc] = await Promise.all([
      d.CompanySubscription.findOne({ company: id }).lean(),
      d.Company.findOne({ _id: id }).select('employees').lean(),
    ]);

    const seatsUsed = Array.isArray(companyDoc?.employees)
      ? companyDoc.employees.filter((e) => String(e?.status || '').toLowerCase() === 'active').length
      : null;

    return response.status(200).json(
      subscriptionBody({
        doc,
        limits: effectiveLimits(doc),
        seatsUsed,
        // El documento no declara `timestamps`, asi que la fecha de alta sale
        // del ObjectId, que la lleva dentro.
        startedAt: doc?._id ? createdAtFromId(String(doc._id)) : null,
      })
    );
  } catch (error) { return fail(request, response, error); }
};

/**
 * GET /companies/:id/merchant
 *
 * 501, con la razon dentro. Ver MERCHANT_NOT_SERVED: todo lo que esta pestaña
 * enseña es estado de Stripe, y este servidor solo guarda el formulario de
 * alta. Contestar 200 con todo a null diria que el cliente no puede cobrar.
 */
const platformCompanyMerchant = () => async (request, response) =>
  response.status(501).json(MERCHANT_NOT_SERVED);

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
  platformAttention,
  // Las nueve pestañas de la ficha
  platformCompanyActivity,
  platformCompanyTransactions,
  platformCompanyEvents,
  platformCompanyInventory,
  platformCompanyMembers,
  platformCompanyConsumers,
  platformCompanyStaff,
  platformCompanySubscription,
  platformCompanyMerchant,
};
