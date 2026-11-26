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

/**
 * Sobre de lista. `total` es el total de verdad, no lo que cabe en la pagina.
 *
 * Las claves opcionales se enumeran de una en una A PROPOSITO —no hay un
 * `...resto`— para que el sobre sea un contrato y no un cajon. El precio es
 * que una clave nueva hay que añadirla aqui: `conditions` se perdio en
 * silencio la primera vez por esto mismo, y lo cogio su test.
 *
 * `conditions` lo usa /attention para decir cuales de sus avisos esta midiendo
 * de verdad. No es lo mismo que `filters`: aquel declara que puede filtrar el
 * cliente, este declara que puede observar el servidor.
 */
const listBody = ({ rows, page, limit, total, totals, filters, conditions }) => ({
  ok: true,
  data: rows,
  page,
  limit,
  total: Number.isFinite(Number(total)) ? Number(total) : rows.length,
  ...(totals ? { totals } : {}),
  ...(filters ? { filters } : {}),
  ...(conditions ? { conditions } : {}),
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
 * VOCABULARIOS QUE EL SERVIDOR NO PUEDE SOSTENER ENTEROS.
 *
 * El console filtra inventario por available|assigned|lost|in_repair, pero
 * `item_inv` solo tiene la columna `warehouse`: dentro o fuera. `lost` e
 * `in_repair` NO son estados que esa tabla registre.
 *
 * Devolver cero filas para `lost` diria "no hay equipos perdidos", que es
 * mentira: lo cierto es "eso no se lleva". Asi que el servidor DECLARA que
 * valores sostiene y cuales no, y el cliente desactiva los que no — el mismo
 * trato que ya existe con `filters.staff` del audit, donde el desplegable
 * espera a que el servidor le diga la lista.
 */
const INVENTORY_STATUS = Object.freeze({
  supported: ['available', 'assigned'],
  unmeasured: ['lost', 'in_repair'],
});

/**
 * La coleccion `Event` NO guarda solo eventos.
 *
 * `type` es un campo del esquema con default 'event', pero el unico punto de
 * escritura es `new Event(request.body)` (controller/event.js:14), asi que el
 * valor llega del cliente y hay documentos que no son eventos de cliente.
 * Todo el servidor que lee eventos de verdad ya lo acota —search.js 727, 1204,
 * 2205 y 2428, event.js 446— y el console era el unico que no.
 *
 * Mongo no avisa de esto: sin el filtro la consulta corre igual y devuelve de
 * mas, que es la forma de equivocarse mas dificil de ver en una lista paginada.
 */
const EVENT_TYPE = 'event';

const EVENT_STATUS = Object.freeze({
  // `upcoming` saldria de `eventInfoDetail.dateBegin`, que vive en un objeto
  // sin esquema y por tanto sin indice: filtrarlo seria un barrido de la
  // coleccion en cada pulsacion del desplegable. Se CALCULA en la fila, que
  // es barato, pero no se ofrece como filtro.
  supported: ['live', 'closed'],
  unmeasured: ['upcoming'],
});

/**
 * GET /api/platform/attention — LAS TRES CONDICIONES, Y CUALES SE MIDEN.
 *
 * El console pide tres (su nota §5): equipos vencidos mas de 7 dias,
 * suscripcion `past_due` o cargo fallido, y ningun acceso de staff en 30 dias.
 * Hoy solo la segunda tiene dato detras.
 *
 * `devicesOverdue` no es que salga cero: es que NO EXISTE. Nadie ha decidido
 * que fecha define "vencido" —la del prestamo, la de devolucion del evento o
 * la del propio aparato, que son tres numeros distintos para el mismo equipo—
 * asi que no hay campo que consultar. Devolver una lista sin esa condicion y
 * callarselo seria peor que no tener la pantalla: un console tranquilo diria
 * que no hay equipos sin volver.
 *
 * La tercera tiene fecha de nacimiento conocida: `lastLoginAt` empezo a
 * escribirse el 2026-11-09, asi que "sin acceso en 30 dias" no se puede
 * afirmar de nadie hasta el 2026-12-09. No es una limitacion de coste, es que
 * el dato no tiene edad suficiente. Se enciende sola ese dia.
 */
const STAFF_DORMANT_FROM = '2026-12-09';

/** Estados de suscripcion que ponen a un cliente en la lista. */
const ATTENTION_SUBSCRIPTION_STATUSES = Object.freeze([
  'past_due',
  'incomplete',
  'unpaid',
  'incomplete_expired',
]);

/**
 * Que condiciones estan midiendo hoy, dicho en la respuesta.
 *
 * Va DENTRO del cuerpo y no en la documentacion a proposito: quien mira la
 * pantalla tiene que poder saber que no la esta viendo entera.
 */
const attentionConditions = (now = new Date()) => ({
  devicesOverdue: {
    active: false,
    reason: 'no field defines "overdue"; the due date has not been chosen between lease, event and device',
  },
  subscription: { active: true },
  staffDormant: {
    active: new Date(now) >= new Date(`${STAFF_DORMANT_FROM}T00:00:00.000Z`),
    availableFrom: STAFF_DORMANT_FROM,
    reason: 'lastLoginAt has only been written since 2026-11-09, so 30 days of absence cannot be claimed before then',
  },
});

/** Una fila de /attention. */
const attentionRow = ({ kind, company = {}, reason = null } = {}) => ({
  id: `${kind}:${company.id}`,
  kind,
  companyId: company.id ?? null,
  companyName: company.name || null,
  reason,
});

/** Sobre de filtros: que acepta el servidor y que no puede medir. */
const filterSupport = (vocab, asked) => {
  const out = { supported: vocab.supported, unmeasured: vocab.unmeasured };
  if (!asked) return out;
  if (vocab.unmeasured.includes(asked)) {
    out.applied = null;
    out.note = `"${asked}" no se registra en el servidor`;
    return out;
  }
  out.applied = asked;
  return out;
};

/**
 * Una fila de GET /api/platform/inventory.
 *
 * `status` traduce la unica columna que existe —`warehouse`— al vocabulario
 * del console: dentro es `available`, fuera es `assigned`. Ver
 * INVENTORY_STATUS para los otros dos.
 *
 * `deviceName` es `item_group`, que es como `item_inv` nombra el modelo. No
 * hay columna que se llame asi; si el console queria `descript_item` o
 * `brand`, se cambia en una linea.
 */
const inventoryRow = ({ row = {}, company = {} } = {}) => ({
  id: String(row.item_id ?? ''),
  companyId: company.companyId ?? null,
  companyName: company.companyName ?? null,
  serial: row.serial_number ?? null,
  deviceName: row.item_group ?? null,
  category: row.category_name ?? null,
  location: row.location ?? null,
  status: Number(row.warehouse) === 0 ? 'assigned' : 'available',
});

/**
 * Una fila de GET /api/platform/transactions.
 *
 * `amountCents` y `status` van SIEMPRE null. El importe no esta guardado en
 * ninguno de los dos modelos —vive en Stripe— y no hay campo de estado:
 * `Transaction.active` es un booleano cuyo significado no esta acordado, y
 * traducirlo a un `status` seria inventarse un vocabulario.
 *
 * NO lleva el correo del consumidor. El console lee `consumerName` en la
 * lista entre clientes y `consumerEmail` solo dentro de la ficha de uno
 * (su nota, seccion 4: la asimetria es deliberada). Mandar el correo aqui
 * sacaria datos personales de TODOS los clientes a una pantalla que no los
 * pide.
 */
const transactionRow = ({ doc = {}, company = {} } = {}) => ({
  id: String(doc._id ?? ''),
  companyId: company.companyId ?? null,
  companyName: company.companyName ?? null,
  companyRef: company.companyRef ?? null,
  createdAt: iso(doc.created_at ?? doc.date),
  consumerName: doc.consumerInfo?.name || null,
  eventName: doc.eventSelected || null,
  eventId: doc.event_id || null,
  type: doc.type || null,
  amountCents: null,
  status: null,
  currency: 'USD',
});

/** live / upcoming / closed, a partir de lo unico que hay. */
const eventStatus = ({ active, startsAt } = {}) => {
  if (!active) return 'closed';
  const begins = startsAt ? Date.parse(startsAt) : NaN;
  return Number.isFinite(begins) && begins > Date.now() ? 'upcoming' : 'live';
};

/**
 * Una fila de GET /api/platform/events.
 *
 * Se cruza por `company_id`, NUNCA por `company`: ese campo se escribe con el
 * nombre, con el id, con un proveedor o vacio segun el camino
 * (controller/event.js 370, 574, 698, 721).
 *
 * `devicesNotReturned` y `revenueCents` van null: lo primero exige saber que
 * es "no devuelto", que hoy no se calcula; lo segundo es dinero.
 */
const eventRow = ({ doc = {}, company = {} } = {}) => {
  const startsAt = iso(doc.eventInfoDetail?.dateBegin);
  return {
    id: String(doc._id ?? ''),
    companyId: company.companyId ?? null,
    companyName: company.companyName ?? null,
    name: doc.eventInfoDetail?.eventName || null,
    status: eventStatus({ active: Boolean(doc.active), startsAt }),
    startsAt,
    endsAt: iso(doc.eventInfoDetail?.dateEnd),
    devicesAssigned: Array.isArray(doc.deviceSetup) ? doc.deviceSetup.length : null,
    devicesNotReturned: null,
    revenueCents: null,
  };
};

/**
 * De `target_model` a la categoria que pinta el console.
 *
 * `target_model` es TEXTO LIBRE y seguira siendolo: una docena de puntos de
 * escritura ponen sus propias cadenas y rechazar una desconocida tiraria filas
 * de auditoria, que es lo unico que un registro no puede hacer. Asi que este
 * mapa es parcial por construccion.
 *
 * Lo que no casa va a `null`, NO a un cajon de sastre. Una fila mal
 * clasificada desaparece del filtro que le tocaba y aparece en otro; una fila
 * sin categoria se ve que no la tiene.
 */
const ACTIVITY_CATEGORY = Object.freeze({
  Transaction: 'transaction', StripeTransaction: 'transaction', Fee: 'transaction',
  CashReport: 'transaction', StripeAccount: 'transaction', StripeLink: 'transaction',
  Event: 'event', EventInvitation: 'event', Signature: 'event', Terms: 'event',
  Inventory: 'inventory', Item: 'inventory', Device: 'inventory', Container: 'inventory',
  Category: 'inventory', Group: 'inventory', Location: 'inventory', SubLocation: 'inventory',
  Shipment: 'inventory', Identifier: 'inventory',
  Member: 'member', Guardian: 'member', Consent: 'member', Lease: 'member',
  Consumer: 'member', User: 'member',
  Staff: 'staff', AdminUser: 'staff', Invitation: 'staff', Company: 'staff',
  Subscription: 'staff', ActivityLog: 'staff', Assistant: 'staff',
});

const activityCategory = (targetModel) => ACTIVITY_CATEGORY[String(targetModel || '')] || null;

/**
 * Una fila de GET /api/platform/activity.
 *
 * La fecha es `timestamp`. NO `createdAt`: StaffActivityLog no declara
 * `timestamps: true` y define su propio campo. Filtrar u ordenar por
 * `createdAt` no da error — no casa con nada y la respuesta sale vacia.
 *
 * Sin `actorEmail`: esta lista cruza clientes y el console no lo lee aqui. El
 * correo del operador solo aparece en `/audit`, que es su sitio.
 */
const activityRow = ({ doc = {}, company = {} } = {}) => ({
  id: String(doc._id ?? ''),
  companyId: company.companyId ?? null,
  companyName: company.companyName ?? null,
  at: iso(doc.timestamp),
  actorName: doc.actor?.name || null,
  summary: doc.summary || null,
  category: activityCategory(doc.target_model),
  action: doc.action || null,
  targetModel: doc.target_model || null,
});

/**
 * Fecha de alta de un documento de Mongo.
 *
 * `Company` no declara `timestamps: true`, asi que no hay `createdAt`. El
 * ObjectId lleva dentro el segundo en que se creo, asi que la fecha es exacta
 * y no hay que migrar nada: un campo nuevo solo serviria para los documentos
 * futuros y dejaria a los 21 clientes actuales sin fecha.
 */
const createdAtFromId = (id) => {
  const hex = String(id || '').slice(0, 8);
  if (!/^[0-9a-f]{8}$/i.test(hex)) return null;
  return new Date(parseInt(hex, 16) * 1000).toISOString();
};

/**
 * GET /api/platform/companies/:id — registro PLANO, como lo lee el console.
 *
 * Reutiliza la fila de la lista para que el estado no se calcule dos veces y
 * pueda salir distinto en dos pantallas.
 */
const companyDetailBody = ({ row = {}, company = {}, sqlId = null, counts = {} } = {}) => ({
  ok: true,
  data: {
    ...row,
    phone: company?.phone?.main || null,
    createdAt: createdAtFromId(row.id),
    mongoId: row.id,
    sqlId,
    eventsActive: counts.eventsActive ?? null,
    membersCount: counts.membersCount ?? null,
    consumersCount: counts.consumersCount ?? null,
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
  INVENTORY_STATUS,
  EVENT_TYPE,
  EVENT_STATUS,
  filterSupport,
  eventStatus,
  activityCategory,
  ACTIVITY_CATEGORY,
  STAFF_DORMANT_FROM,
  ATTENTION_SUBSCRIPTION_STATUSES,
  attentionConditions,
  attentionRow,
  createdAtFromId,
  inventoryRow,
  transactionRow,
  eventRow,
  activityRow,
  companyDetailBody,
};
