/**
 * LAS NUEVE PESTAÑAS DE LA FICHA DE UN CLIENTE.
 *
 * GET /api/platform/companies/:id/<recurso>, que el console pide SOLO cuando se
 * abre esa pestaña (su nota, §4: la ficha nunca dispara nueve peticiones).
 *
 * Por que un fichero aparte de platformConsole.js: estas filas son del MISMO
 * cliente, asi que pueden llevar datos personales que las listas de la consola
 * —que cruzan clientes— no pueden. `consumerEmail` aqui y `consumerName` alli
 * es una asimetria DELIBERADA del console, no un descuido; tenerlas en dos
 * ficheros hace que nadie reutilice la fila equivocada por costumbre.
 *
 * La regla de siempre: un dato que el servidor no tiene sale `null`, nunca 0 ni
 * una cadena vacia. Un cero es una afirmacion —"no hay ninguno"— y en esta
 * ficha la lee una persona que decide si llamar al cliente.
 */

const { iso } = require('./platformConsole');

/**
 * Los nueve recursos, y de donde sale cada uno.
 *
 * `merchant` NO esta: ver `MERCHANT_NOT_SERVED` al final del fichero.
 */
const COMPANY_TAB_RESOURCES = Object.freeze([
  'activity',
  'transactions',
  'events',
  'inventory',
  'members',
  'consumers',
  'staff',
  'subscription',
]);

const isCompanyTab = (value) => COMPANY_TAB_RESOURCES.includes(String(value || ''));

/** Nombre a partir de dos columnas, sin dejar " " cuando faltan las dos. */
const fullName = (first, last) => {
  const name = `${String(first ?? '').trim()} ${String(last ?? '').trim()}`.trim();
  return name || null;
};

// ─────────────────────────────────────────────────────────── activity ────

/**
 * Fila de /companies/:id/activity.
 *
 * La fecha es `timestamp`. StaffActivityLog no declara `timestamps: true`, asi
 * que `createdAt` no existe ahi: ordenar por el no da error, devuelve vacio.
 *
 * `source` SI es un campo del modelo (StaffActivityLog:89), a diferencia de
 * `category`, que se deriva de `target_model` porque no esta guardado.
 */
const companyActivityRow = ({ doc = {}, category = null } = {}) => ({
  id: String(doc._id ?? ''),
  at: iso(doc.timestamp),
  category,
  actorName: doc.actor?.name || null,
  summary: doc.summary || null,
  source: doc.source || null,
});

// ─────────────────────────────────────────────────────── transactions ────

/**
 * Fila de /companies/:id/transactions.
 *
 * Lleva `consumerEmail` —y la lista entre clientes lleva `consumerName`— por
 * la decision del console: dentro de la ficha de UN cliente el correo tiene
 * dueño conocido; en una lista que cruza clientes, no.
 *
 * `amountCents` y `status` van siempre null: el importe vive en Stripe y no
 * esta guardado en ninguno de los dos modelos, y no hay campo de estado
 * (`Transaction.active` es un booleano cuyo significado no esta acordado).
 */
const companyTransactionRow = ({ doc = {} } = {}) => ({
  id: String(doc._id ?? ''),
  createdAt: iso(doc.created_at ?? doc.date),
  type: doc.type || null,
  consumerEmail: doc.consumerInfo?.email || null,
  consumerName: doc.consumerInfo?.name || null,
  eventName: doc.eventSelected || null,
  eventId: doc.event_id || null,
  amountCents: null,
  status: null,
  currency: 'USD',
});

// ───────────────────────────────────────────────────────────── events ────

/**
 * Fila de /companies/:id/events.
 *
 * `consumersCount` SI se puede: `User.event_providers` guarda ids de evento
 * (verificado, a diferencia de `eventSelected`, que guarda nombres). Llega
 * contado de fuera para no hacer una consulta por fila.
 *
 * `devicesNotReturned` y `revenueCents` van null: lo primero exige una
 * definicion de "no devuelto" que el negocio aun no ha dado; lo segundo es
 * dinero.
 */
const companyEventRow = ({ doc = {}, consumersCount = null, status = null } = {}) => ({
  id: String(doc._id ?? ''),
  name: doc.eventInfoDetail?.eventName || null,
  status,
  startsAt: iso(doc.eventInfoDetail?.dateBegin),
  endsAt: iso(doc.eventInfoDetail?.dateEnd),
  devicesAssigned: Array.isArray(doc.deviceSetup) ? doc.deviceSetup.length : null,
  devicesNotReturned: null,
  consumersCount,
  // El contacto del evento, que es lo mas cercano a "quien lo lleva" que hay
  // guardado. `staff` es un objeto sin esquema y no se puede leer de fiar.
  leadName: fullName(doc.contactInfo?.name, doc.contactInfo?.lastName),
  revenueCents: null,
});

// ────────────────────────────────────────────────────────── inventory ────

/**
 * Fila de /companies/:id/inventory — AGRUPADA por modelo, no por aparato.
 *
 * La lista entre clientes enseña un aparato por fila; esta enseña un grupo con
 * sus totales, que es lo que pide el console (`groupName`, `total`,
 * `available`, `out`).
 *
 * `lost` va null por lo mismo que en la otra lista: `item_inv` solo tiene
 * `warehouse` —dentro o fuera— y "perdido" no es un estado que esa tabla
 * registre. Un 0 aqui diria que no se ha perdido ninguno.
 *
 * `serialRange` se arma con MIN/MAX de texto, NO numerico: los seriales llevan
 * un contador al final y el console avisa de que nadie debe pasarlos por
 * Number(). Con relleno de ceros desigual el rango puede quedar raro; es
 * preferible a inventarse un orden.
 */
const companyInventoryRow = ({ row = {} } = {}) => {
  const min = row.serial_min ?? null;
  const max = row.serial_max ?? null;
  return {
    groupName: row.item_group ?? null,
    category: row.category_name ?? null,
    serialRange: min && max ? (min === max ? String(min) : `${min} – ${max}`) : null,
    total: Number(row.total ?? 0),
    available: Number(row.available ?? 0),
    out: Number(row.out_now ?? 0),
    lost: null,
    location: row.location ?? null,
  };
};

// ──────────────────────────────────────────────────────────── members ────

/**
 * Fila de /companies/:id/members — alumnos, desde `members_info` (SQL).
 *
 * Tres de los campos que el console lee NO son columnas de esa tabla:
 *
 *   status    no existe; no hay alta ni baja de un alumno
 *   joinedAt  no existe; la tabla no guarda cuando se dio de alta
 *   devicesOut exigiria cruzar con los prestamos, que es otra pantalla
 *
 * Van null y el console deja de pintar la columna, que es el trato que ya
 * funciona con el dinero.
 */
const memberRow = ({ row = {} } = {}) => ({
  id: String(row.member_id ?? ''),
  name: fullName(row.first_name, row.last_name),
  memberId: row.external_id || String(row.member_id ?? ''),
  email: row.email || null,
  status: null,
  devicesOut: null,
  joinedAt: null,
});

// ────────────────────────────────────────────────────────── consumers ────

/**
 * Fila de /companies/:id/consumers.
 *
 * Sale de Mongo (`User.company_providers`), NO de `consumer_info`: esa tabla
 * SQL no tiene columna de compañia —los consumidores cuelgan del evento— y
 * `company_providers` es el campo que si guarda el id del cliente.
 *
 * `transactionsCount` llega contado de fuera, en una sola consulta agrupada
 * para toda la pagina. `status` y `lastSeenAt` no estan guardados en ninguna
 * parte: `User` no lleva ni estado ni fecha de ultimo acceso.
 */
const consumerRow = ({ doc = {}, transactionsCount = null } = {}) => ({
  id: String(doc._id ?? ''),
  name: fullName(doc.name, doc.lastName),
  email: doc.email || null,
  status: null,
  devicesOut: null,
  transactionsCount,
  lastSeenAt: null,
});

// ────────────────────────────────────────────────────────────── staff ────

/**
 * Fila de /companies/:id/staff.
 *
 * El equipo de un cliente vive en `Company.employees[]`, que guarda el nombre,
 * el correo y el rol. Lo que NO guarda —MFA, ultimo acceso— esta en
 * `AdminUser`, que es la cuenta de verdad, asi que las dos se cruzan por
 * correo. Un empleado sin cuenta sale con esos campos a null, que es lo
 * cierto: no ha entrado nunca porque no puede.
 *
 * `actions30d` llega contado de fuera, agrupado para toda la pagina.
 */
const staffRow = ({ employee = {}, account = null, actions30d = null } = {}) => ({
  id: String(employee.user || employee.email || ''),
  name: fullName(employee.firstName, employee.lastName),
  email: employee.email || null,
  role: employee.roleType || employee.role || null,
  // El console llama `scope` a hasta donde llega ese rol. Los roles de
  // categoria (category_manager, category_assistant) son los unicos acotados;
  // el resto alcanza toda la compañia.
  scope: /^category_/.test(String(employee.roleType || '')) ? 'category' : 'company',
  twoStepEnabled: account ? Boolean(account.mfaEnabled) : null,
  lastLoginAt: account ? iso(account.lastLoginAt) : null,
  actions30d,
  status: employee.status || null,
});

// ─────────────────────────────────────────────────────── subscription ────

/**
 * Registro de /companies/:id/subscription.
 *
 * `startedAt` sale del ObjectId del documento, porque CompanySubscription se
 * creo sin `timestamps` y un campo nuevo solo serviria para los clientes
 * futuros.
 *
 * `priceCents` y `paymentMethodLast4` van null: los dos viven en Stripe. Hoy
 * todos los clientes estan en el plan gratuito, asi que la pestaña es la menos
 * urgente de las nueve —el propio console lo dice— pero contestar null es
 * distinto de contestar 404.
 */
const subscriptionBody = ({ doc = null, limits = null, seatsUsed = null, startedAt = null } = {}) => ({
  ok: true,
  data: {
    plan: doc?.plan || 'free',
    status: doc?.status || null,
    interval: doc?.interval || null,
    startedAt,
    renewsAt: iso(doc?.current_period_end),
    cancelAtPeriodEnd: doc ? Boolean(doc.cancel_at_period_end) : null,
    demo: doc ? Boolean(doc.demo) : null,
    priceCents: null,
    paymentMethodLast4: null,
    seatsUsed,
    seatsLimit: limits?.staff ?? null,
  },
});

// ─────────────────────────────────────────────────────────── merchant ────

/**
 * La pestaña que NO se sirve, y por que.
 *
 * El console lee: accountId, chargesEnabled, payoutsEnabled, payoutSchedule,
 * requirementsDue[], balanceCents, disputesOpen, fees30dCents, lastPayoutAt.
 *
 * TODOS son estado de la cuenta en Stripe. Lo que este servidor guarda
 * (`StripeConnectedAccount`) es el formulario de ALTA que se le mando a Stripe
 * el dia que se creo la cuenta, no lo que Stripe opina de ella hoy: si una
 * cuenta dejo de poder cobrar esta mañana, aqui no se enteraria nadie.
 *
 * Servirla exige llamar a la API de Stripe por cliente, que es:
 *   - una dependencia externa nueva en una ruta de lectura del console,
 *   - un servicio mas que declarar en el inventario SA-9, y
 *   - una decision sobre cache, porque la pestaña se abre a mano.
 *
 * Ademas `models/StripeConnectedAccount.js` revienta al importarse
 * (`mcc is not defined`, linea 61), asi que hoy no se puede ni leer el alta.
 *
 * Contesta 501 y lo explica. NO 404 —la ruta existe— y NO 200 con todo a null,
 * que diria que la cuenta no cobra.
 */
const MERCHANT_NOT_SERVED = Object.freeze({
  ok: false,
  resource: 'merchant',
  msg: 'Merchant status is held by Stripe, not by this server. Serving it requires a live Stripe call per client, which is not built.',
  needs: Object.freeze([
    'a Stripe API call per client (account, balance, payouts)',
    'the service declared in the SA-9 external services inventory',
    'models/StripeConnectedAccount.js fixed — it throws on import (mcc is not defined)',
  ]),
});

module.exports = {
  COMPANY_TAB_RESOURCES,
  isCompanyTab,
  fullName,
  companyActivityRow,
  companyTransactionRow,
  companyEventRow,
  companyInventoryRow,
  memberRow,
  consumerRow,
  staffRow,
  subscriptionBody,
  MERCHANT_NOT_SERVED,
};
