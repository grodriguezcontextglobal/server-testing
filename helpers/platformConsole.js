'use strict';

/**
 * Console de plataforma — forma de las respuestas y reglas de negocio (DC3).
 *
 * Todo lo de aqui es PURO: ni Mongo, ni SQL, ni Stripe. Los controladores traen
 * los datos y esto los convierte en lo que el console pinta. Asi las reglas
 * —que compañia esta "en riesgo", que cuenta como dispositivo fuera— se pueden
 * probar sin una base delante, que es lo unico que las mantiene honestas.
 *
 * LA FORMA DE LA RESPUESTA la fijo el dashboard y la tomamos tal cual
 * (`normalizeSectionResponse` en su clientProfile.js):
 *
 *     { ok, data, page, limit, total, totals?, filters? }
 *
 * Dinero en centimos enteros, fechas en ISO UTC con Z, y `total` un conteo de
 * verdad y no `data.length`.
 */

/** Tope de pagina del servidor. Pedir mas no es un error: te dan 100. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/**
 * Los recursos que el console puede leer. LISTA CERRADA, no un segmento de
 * ruta que se pasa a ciegas: si fuera pasante, "que puede leer un operador" se
 * contestaria mirando el cliente, y no se puede contestar desde nuestro codigo.
 * Lo pidio el dashboard y tiene razon.
 *
 * `people` NO esta, y su ausencia es la decision del 2026-11-19: miembros y
 * consumidores se leen DENTRO del perfil de un cliente, nunca entre clientes.
 */
const PLATFORM_RESOURCES = Object.freeze([
  'activity',
  'audit',
  'events',
  'inventory',
  'transactions',
]);

/** Los que ademas existen dentro de un cliente. `staff` solo aqui, nunca global. */
const COMPANY_RESOURCES = Object.freeze([
  'activity',
  'consumers',
  'events',
  'inventory',
  'members',
  'merchant',
  'staff',
  'subscription',
  'transactions',
]);

const isPlatformResource = (name) => PLATFORM_RESOURCES.includes(String(name || ''));
const isCompanyResource = (name) => COMPANY_RESOURCES.includes(String(name || ''));

/** Pagina y tope, saneados. Un limit absurdo da el tope, no un error. */
const readPaging = (query = {}) => {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const asked = Math.floor(Number(query.limit));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
  return { page, limit };
};

/** Sobre de lista. `total` es el total de verdad, no lo que cabe en la pagina. */
const listBody = ({ rows, page, limit, total, totals, filters }) => ({
  ok: true,
  data: rows,
  page,
  limit,
  total: Number.isFinite(Number(total)) ? Number(total) : rows.length,
  ...(totals ? { totals } : {}),
  ...(filters ? { filters } : {}),
});

const iso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Los rangos que acepta /summary. Cualquier otra cosa es 30d, no un error. */
const RANGES = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 });
const readRange = (value) => (RANGES[String(value || '')] ? String(value) : '30d');
const rangeDays = (value) => RANGES[readRange(value)];

/**
 * ESTADO DE UN CLIENTE, calculado en el servidor.
 *
 * El dashboard pinta cuatro pastillas (active / at_risk / trial / paused) y no
 * define cual es cual: es una regla de negocio y vive aqui, en un sitio, para
 * que la misma compañia no salga "en riesgo" en una pantalla y "activa" en otra.
 *
 * El orden importa. Una suscripcion cancelada manda sobre todo lo demas: una
 * compañia pausada con dispositivos vencidos sigue estando pausada, y pintarla
 * "en riesgo" invitaria a perseguir a un cliente que ya se fue.
 *
 * `incomplete` e `incomplete_expired` se parecen y NO son lo mismo, por eso
 * estan en lineas distintas. `incomplete` es el primer cobro que aun no ha
 * cuajado: hay ~23 h para salvarlo, asi que es `at_risk` y alguien deberia
 * llamar. `incomplete_expired` es esa ventana ya cerrada: la suscripcion no
 * llego a arrancar nunca y no se puede revivir, que es un final, no un aviso.
 * Lo encontro el dashboard el 2026-11-20 revisando esta regla: sin nombrarlo,
 * caia al `return 'active'` del fondo y un cliente que jamas pago salia sano —
 * justo el fallo que este orden existe para evitar.
 */
const companyStatus = ({ subscriptionStatus, devicesOverdue } = {}) => {
  const status = String(subscriptionStatus || '').toLowerCase();
  if (status === 'canceled' || status === 'cancelled' || status === 'unpaid') return 'paused';
  if (status === 'incomplete_expired') return 'paused';
  if (status === 'trialing') return 'trial';
  if (status === 'past_due' || status === 'incomplete') return 'at_risk';
  if (Number(devicesOverdue) > 0) return 'at_risk';
  return 'active';
};

/** Empleados activos. `active !== false` para no castigar al que es anterior al campo. */
const activeEmployees = (company) =>
  (company?.employees || []).filter((e) => e?.active !== false).length;

/**
 * Una fila de GET /api/platform/companies, con los nombres de campo que su
 * tabla ya espera (PlatformClientsPage.jsx:23).
 *
 * `revenue30dCents` SIEMPRE null, y no es un olvido: NINGUNO de los dos modelos
 * de transaccion guarda el importe. `Transaction` tiene device, paymentIntent,
 * consumerInfo, event_id, date, company y type; `StripeTransaction` tampoco lo
 * tiene. El dinero vive en Stripe y solo ahi, asi que una cifra de ingresos no
 * es una consulta a nuestra base: es una llamada por cliente a una API externa.
 * Devolver null es decir "no lo se" — su tabla ya pinta un guion. Devolver 0
 * seria decir "este cliente no facturo nada", que es una frase distinta y
 * falsa.
 */
const companyRow = ({ company, counts = {}, subscription, lastActivityAt } = {}) => {
  const devicesOverdue = counts.devicesOverdue ?? null;
  return {
    id: String(company._id),
    name: company.company_name || '',
    ownerName: [company?.owner?.first_name, company?.owner?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim(),
    ownerEmail: company?.owner?.email || company?.main_email || null,
    plan: subscription?.plan || 'Free',
    status: companyStatus({ subscriptionStatus: subscription?.status, devicesOverdue }),
    staffCount: activeEmployees(company),
    deviceCount: counts.deviceCount ?? null,
    devicesOut: counts.devicesOut ?? null,
    devicesOverdue,
    revenue30dCents: null,
    currency: 'USD',
    lastActivityAt: iso(lastActivityAt),
  };
};

/**
 * Filtro y orden de la lista de clientes, con los parametros que su
 * `buildCompaniesQuery` manda: search, status, plan, page, limit.
 *
 * Se filtra DESPUES de construir las filas porque `status` y `plan` son campos
 * calculados: no existen en Mongo y no se pueden pasar a una consulta. Con 21
 * compañias eso no es un problema; el dia que sean miles habra que precalcular
 * el estado, y entonces este comentario sera el aviso de por que.
 */
const filterCompanies = (rows, query = {}) => {
  const term = String(query.search || '').trim().toLowerCase();
  const status = String(query.status || '').trim();
  const plan = String(query.plan || '').trim().toLowerCase();

  return rows.filter((row) => {
    if (status && status !== 'all' && row.status !== status) return false;
    // "Pro" casa tambien con "Pro (trial)": el trial es un estado, no un plan.
    if (plan && plan !== 'all' && !String(row.plan || '').toLowerCase().startsWith(plan)) {
      return false;
    }
    if (!term) return true;
    return [row.name, row.ownerName, row.ownerEmail].some((field) =>
      String(field || '').toLowerCase().includes(term)
    );
  });
};

const sortCompanies = (rows) =>
  [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));

/** Corta una pagina de un array ya filtrado. */
const pageOf = (rows, { page, limit }) => rows.slice((page - 1) * limit, (page - 1) * limit + limit);

/**
 * GET /api/platform/summary — conteos de toda la plataforma, sin nombrar a
 * ningun cliente. Es la unica pantalla que se puede dejar abierta en un
 * monitor compartido, y esa propiedad merece conservarse.
 *
 * `current` y `previous` para que el console pinte la variacion sin pedir dos
 * veces. Las cifras de dinero van a null por lo mismo que en companyRow.
 */
const summaryBody = ({ range, companies = [], events = [], devices = {}, staff = {} } = {}) => {
  const resolved = readRange(range);
  const live = companies.filter((c) => c.status !== 'paused').length;
  return {
    ok: true,
    data: {
      range: resolved,
      rangeDays: rangeDays(resolved),
      current: {
        activeClients: live,
        totalClients: companies.length,
        clientsAtRisk: companies.filter((c) => c.status === 'at_risk').length,
        activeEvents: Number(events.live ?? 0),
        devicesOut: devices.out ?? null,
        devicesOverdue: devices.overdue ?? null,
        staffAccounts: staff.total ?? null,
        staffWithMfa: staff.withMfa ?? null,
        revenueCents: null,
        transactions: null,
        failedPayments: null,
      },
      // Sin dinero no hay comparacion de dinero. El bloque se devuelve igual
      // para que el cliente no tenga que distinguir dos formas de respuesta.
      previous: null,
      topClientsByRevenue: [],
      computedAt: new Date().toISOString(),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// DC3 — segunda tanda: inventory, transactions, events, activity y el detalle
// de un cliente. Son los recursos que ya estaban en PLATFORM_RESOURCES; lo
// unico que faltaba era construirlos.
//
// TODAS estas filas nombran al cliente, y ahi esta el unico riesgo nuevo: una
// fila atribuida a la compañia equivocada es peor que una fila sin compañia.
// Por eso `resolveCompany` devuelve null y no adivina.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * De lo que guarda un documento a un cliente concreto.
 *
 * `Transaction.company` se escribe con `new Transaction(request.body)`: es lo
 * que mande el cliente, sin validar. En unos sitios es el id de Mongo y en
 * otros el nombre —el mismo patron de `eventSelected`, que guarda el nombre—,
 * asi que se prueban los dos. Si no resuelve, `companyId` va null y el valor
 * crudo se conserva en `companyRef`: el operador ve que hay una fila que no
 * sabemos de quien es, que es la verdad. Atribuirla por parecido seria
 * enseñarle el movimiento de un cliente a otro.
 */
const resolveCompany = (raw, { byId = new Map(), byName = new Map() } = {}) => {
  const key = String(raw ?? '').trim();
  if (!key) return { companyId: null, companyName: null, companyRef: null };
  const hit = byId.get(key) || byName.get(key.toLowerCase());
  if (!hit) return { companyId: null, companyName: null, companyRef: key };
  return { companyId: String(hit.id), companyName: hit.name || null, companyRef: key };
};

/** Indices para `resolveCompany`, construidos una vez por peticion. */
const companyIndex = (rows = []) => ({
  byId: new Map(rows.map((r) => [String(r.id), r])),
  byName: new Map(rows.map((r) => [String(r.name || '').toLowerCase(), r])),
});

/**
 * Una fila de GET /api/platform/inventory.
 *
 * El cruce es por `company_id` de SQL, que es un numero y es de fiar — no por
 * nombre. `location` es el NOMBRE de la ubicacion, porque asi lo guarda
 * `item_inv` (`i.location = l.location_name`), no un id.
 */
const inventoryRow = ({ row = {}, company = {} } = {}) => ({
  id: String(row.item_id ?? ''),
  companyId: company.companyId ?? null,
  companyName: company.companyName ?? null,
  serial: row.serial_number ?? null,
  group: row.item_group ?? null,
  category: row.category_name ?? null,
  location: row.location ?? null,
  // `warehouse` es la columna que ya usa gatherCompanies para contar los que
  // estan fuera. 1 = en almacen.
  status: Number(row.warehouse) === 0 ? 'out' : 'in_warehouse',
  ownership: row.ownership ?? null,
});

/**
 * Una fila de GET /api/platform/transactions.
 *
 * `amountCents` SIEMPRE null, por lo mismo que `revenue30dCents` en
 * `companyRow`: ninguno de los dos modelos de transaccion guarda el importe.
 * Un 0 aqui diria "esta transaccion fue de cero dolares", que es falso.
 *
 * `at` sale de `created_at` (numero, epoch) y si no, de `date` (cadena). Son
 * dos campos distintos con dos tipos distintos para la misma idea; se prueban
 * en ese orden porque `created_at` lo pone el servidor y `date` viene del
 * cuerpo de la peticion.
 */
const transactionRow = ({ doc = {}, company = {} } = {}) => ({
  id: String(doc._id ?? ''),
  companyId: company.companyId ?? null,
  companyName: company.companyName ?? null,
  companyRef: company.companyRef ?? null,
  type: doc.type || null,
  event: doc.eventSelected || null,
  eventId: doc.event_id || null,
  consumer: doc.consumerInfo?.email || doc.consumerInfo?.name || null,
  paymentIntent: doc.paymentIntent || null,
  deviceCount: Array.isArray(doc.device) ? doc.device.length : null,
  amountCents: null,
  currency: 'USD',
  at: iso(doc.created_at ?? doc.date),
});

/**
 * Una fila de GET /api/platform/events.
 *
 * Se cruza por `company_id`, NUNCA por `company`: ese segundo campo se escribe
 * con el nombre, con el id, con un proveedor o vacio segun el camino
 * (controller/event.js 370, 574, 698, 721), asi que no identifica nada.
 *
 * `eventInfoDetail` es un objeto sin esquema; de ahi salen nombre y fechas.
 */
const eventRow = ({ doc = {}, company = {} } = {}) => ({
  id: String(doc._id ?? ''),
  companyId: company.companyId ?? null,
  companyName: company.companyName ?? null,
  name: doc.eventInfoDetail?.eventName || null,
  active: Boolean(doc.active),
  startsAt: iso(doc.eventInfoDetail?.dateBegin),
  endsAt: iso(doc.eventInfoDetail?.dateEnd),
  deviceCount: Array.isArray(doc.deviceSetup) ? doc.deviceSetup.length : null,
  logisticStatus: doc.logistic_inventory_status || null,
});

/**
 * Una fila de GET /api/platform/activity.
 *
 * La fecha es `timestamp`. NO `createdAt`: StaffActivityLog no declara
 * `timestamps: true` y define su propio campo. Filtrar u ordenar por
 * `createdAt` no da error — simplemente no casa con nada y la respuesta sale
 * vacia, que es como se ve un fallo que nadie nota.
 */
const activityRow = ({ doc = {}, company = {} } = {}) => ({
  id: String(doc._id ?? ''),
  companyId: company.companyId ?? null,
  companyName: company.companyName ?? null,
  at: iso(doc.timestamp),
  actorName: doc.actor?.name || null,
  actorEmail: doc.actor?.email || null,
  action: doc.action || null,
  targetModel: doc.target_model || null,
  targetLabel: doc.target_label || null,
  summary: doc.summary || null,
});

/**
 * GET /api/platform/companies/:id — la misma fila de la lista, mas lo que solo
 * tiene sentido mirando a un cliente concreto.
 *
 * Reutiliza `companyRow` a proposito: si el estado se calculara aqui otra vez,
 * un cliente podria salir "en riesgo" en la tabla y "activo" en su ficha.
 */
const companyDetailBody = ({ row, subscription, counts = {} } = {}) => ({
  ok: true,
  data: {
    ...row,
    subscription: subscription
      ? {
          plan: subscription.plan ?? null,
          status: subscription.status ?? null,
          interval: subscription.interval ?? null,
          currentPeriodEnd: iso(subscription.current_period_end),
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
          trialUsed: Boolean(subscription.trial_used),
          demo: Boolean(subscription.demo),
        }
      : null,
    counts: {
      events: counts.events ?? null,
      transactions: counts.transactions ?? null,
      activity30d: counts.activity30d ?? null,
    },
    computedAt: new Date().toISOString(),
  },
});

module.exports = {
  MAX_LIMIT,
  DEFAULT_LIMIT,
  PLATFORM_RESOURCES,
  COMPANY_RESOURCES,
  isPlatformResource,
  isCompanyResource,
  readPaging,
  listBody,
  iso,
  readRange,
  rangeDays,
  companyStatus,
  activeEmployees,
  companyRow,
  filterCompanies,
  sortCompanies,
  pageOf,
  summaryBody,
  // DC3, segunda tanda
  resolveCompany,
  companyIndex,
  inventoryRow,
  transactionRow,
  eventRow,
  activityRow,
  companyDetailBody,
};
