'use strict';

/**
 * POST /api/assistant/ask — el asistente de staff.
 *
 * QUE HACE, EN UNA LINEA: traduce la pregunta de un miembro de staff a UNA
 * entrada del catalogo, la ejecuta con SU compañia y SU alcance, y deja la
 * lectura registrada.
 *
 * TRES COSAS QUE NO HACE, Y LAS TRES SON DECISIONES
 *
 * 1. NO acepta la identidad del cuerpo. `company_id` y `staff_member_id` pueden
 *    venir en el body —el dashboard los manda— y aqui no se leen para decidir
 *    nada. `request.sqlStaffId` sale del JWT firmado, y la compañia de
 *    `resolveCompanyContext`, que ademas comprueba membresia activa. Hasta el
 *    2026-10-21 la identidad de staff caia a una cabecera del cliente, lo que la
 *    hacia autodeclarada (middlewares/validate-jwt.js:24); no se reabre esa
 *    puerta por otro lado.
 *
 * 2. NO llama a ningun servicio externo. El emparejador es local
 *    (helpers/assistantCatalog.js) y el motivo esta escrito alli: el texto que
 *    escribe el staff no sale de la frontera del sistema, asi que esto no añade
 *    ninguna linea al diagrama de flujo de datos del SSP (APP-2026-001).
 *
 * 3. NO modifica nada. Es solo lectura, y reutiliza los helpers que ya existen
 *    —`resolveCompanyContext`, `buildInventoryScopeFilter`, `companyStatus`— en
 *    vez de reimplementar sus reglas. Esa es la propiedad que lo hace seguro de
 *    añadir: si el asistente se apaga, no queda rastro en nada.
 *
 * EL ALCANCE VIAJA DENTRO DE CADA CONSULTA, no es una puerta a la entrada.
 * `buildInventoryScopeFilter` devuelve un fragmento de SQL con cuatro casos, uno
 * de ellos `1=0` para un rol scoped sin asignaciones. Por eso las consultas de
 * inventario lo concatenan siempre y nunca preguntan "¿tiene permiso?" como si
 * fuera un si o un no.
 */

const {
  matchQuestion,
  validateChoice,
  catalogOffer,
  checkQuestionLength,
  questionById,
  UNSUPPORTED,
} = require('../helpers/assistantCatalog');
const { resolveCompanyContext } = require('../mysql/helpers/companyContext');
const { buildInventoryScopeFilter } = require('../mysql/helpers/staffAccess');
const { companyStatus, activeEmployees, iso } = require('../helpers/platformConsole');

/**
 * Dependencias inyectables, igual que en controller/platform.js: los tests no
 * tienen ni Mongo ni MySQL, y una regla que solo se puede probar con una base
 * delante es una regla que no se prueba.
 */
const realDeps = () => ({
  Company: require('../models/Company'),
  CompanySubscription: require('../models/CompanySubscription'),
  StaffActivityLog: require('../models/StaffActivityLog'),
  Event: require('../models/Event'),
  query: (sql, params) => require('../mysql/database/config')().query(sql, params),
  resolveCompanyContextFn: resolveCompanyContext,
});

const withDeps = (deps) => ({ ...realDeps(), ...(deps || {}) });

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * El id SQL manda —es el que autorizo `resolveCompanyContext`— y de el se deduce
 * el de Mongo. El cruce es el MISMO que usa el console (controller/platform.js:
 * 120): primero `sql_company_id` de la suscripcion, y si no hay, por nombre.
 *
 * Sin cruce no se inventa nada: las preguntas que viven en Mongo devuelven
 * `null` y lo dicen. "No lo se" es una respuesta; un cero no lo seria.
 */
async function resolveCompanyIdentity(d, sqlCompanyId) {
  const subscription = await d.CompanySubscription.findOne({
    sql_company_id: String(sqlCompanyId),
  })
    .select('company plan status sql_company_id')
    .lean();

  if (subscription?.company) {
    return { sqlId: sqlCompanyId, mongoId: String(subscription.company), subscription };
  }

  const [rows] = await d.query('SELECT company_name FROM company_info WHERE company_id = ? LIMIT 1', [
    sqlCompanyId,
  ]);
  const name = rows?.[0]?.company_name;
  if (!name) return { sqlId: sqlCompanyId, mongoId: null, subscription: null };

  const company = await d.Company.findOne({ company_name: name }).select('_id').lean();
  return {
    sqlId: sqlCompanyId,
    mongoId: company ? String(company._id) : null,
    subscription: null,
  };
}

/** Une el fragmento de alcance a un WHERE que ya tiene condiciones. */
const withScope = (baseSql, scope) => (scope.sql ? `${baseSql} AND ${scope.sql}` : baseSql);

// ─────────────────────────────────────────────────────── resolutores ─────────
//
// Uno por entrada del catalogo. Cada uno devuelve `{ data, answer }`: los datos
// para que el dashboard los pinte como quiera, y una frase para la ventana de
// chat. La frase la compone el servidor, no un modelo: es determinista y dice
// exactamente lo que los datos dicen.

const resolvers = {
  async company_inventory_summary({ d, identity, access }) {
    const scope = buildInventoryScopeFilter(access);
    const [rows] = await d.query(
      withScope(
        'SELECT COUNT(*) AS total, SUM(warehouse = 0) AS out_now FROM item_inv WHERE company_id = ?',
        scope
      ),
      [identity.sqlId, ...scope.params]
    );
    const total = Number(rows?.[0]?.total ?? 0);
    const out = Number(rows?.[0]?.out_now ?? 0);
    return {
      data: { deviceCount: total, devicesOut: out, inWarehouse: total - out },
      answer: `Tienes **${total}** equipos registrados: **${out}** fuera y **${total - out}** en almacen.`,
    };
  },

  async company_devices_out({ d, identity, access }) {
    const scope = buildInventoryScopeFilter(access);
    const [rows] = await d.query(
      withScope('SELECT COUNT(*) AS out_now FROM item_inv WHERE company_id = ? AND warehouse = 0', scope),
      [identity.sqlId, ...scope.params]
    );
    const out = Number(rows?.[0]?.out_now ?? 0);
    return {
      data: { devicesOut: out },
      answer:
        out === 0
          ? 'No tienes ningun equipo fuera del almacen ahora mismo.'
          : `Tienes **${out}** equipo${out === 1 ? '' : 's'} fuera del almacen ahora mismo.`,
    };
  },

  async company_events_active({ d, identity, params }) {
    if (!identity.mongoId) return unknownCompany('eventos');
    const events = await d.Event.find({ company_id: identity.mongoId, active: true })
      .select('eventInfoDetail company active')
      .limit(params.limit)
      .lean();
    const names = events.map((e) => e?.eventInfoDetail?.eventName || 'sin nombre');
    return {
      data: { activeEvents: events.length, events: names },
      answer:
        events.length === 0
          ? 'No tienes eventos activos ahora mismo.'
          : `Tienes **${events.length}** evento${events.length === 1 ? '' : 's'} activo${
              events.length === 1 ? '' : 's'
            }: ${names.join(', ')}.`,
    };
  },

  async company_staff_list({ d, identity, params }) {
    if (!identity.mongoId) return unknownCompany('el staff');
    const company = await d.Company.findById(identity.mongoId).select('employees').lean();
    if (!company) return unknownCompany('el staff');
    const active = (company.employees || []).filter((e) => e?.active !== false);
    const shown = active.slice(0, params.limit).map((e) => ({
      name: [e?.firstName, e?.lastName].filter(Boolean).join(' ').trim() || e?.email || 'sin nombre',
      role: e?.role ?? null,
    }));
    return {
      data: { staffCount: activeEmployees(company), staff: shown },
      answer: `Tienes **${active.length}** miembro${active.length === 1 ? '' : 's'} de staff activo${
        active.length === 1 ? '' : 's'
      }.`,
    };
  },

  async company_subscription_status({ d, identity }) {
    const subscription =
      identity.subscription ||
      (identity.mongoId
        ? await d.CompanySubscription.findOne({ company: identity.mongoId })
            .select('plan status')
            .lean()
        : null);

    if (!subscription) {
      return {
        data: { plan: null, subscriptionStatus: null, status: null },
        answer: 'No encuentro una suscripcion asociada a tu compañia.',
      };
    }

    // La pastilla se calcula con la MISMA funcion que pinta el console. Si
    // alguna vez cambia la regla, cambia en los dos sitios a la vez porque solo
    // hay un sitio.
    const status = companyStatus({ subscriptionStatus: subscription.status });
    return {
      data: { plan: subscription.plan || 'Free', subscriptionStatus: subscription.status, status },
      answer: `Tu plan es **${subscription.plan || 'Free'}** y la suscripcion figura como **${status}**.`,
    };
  },

  async company_activity_recent({ d, identity, params }) {
    if (!identity.mongoId) return unknownCompany('la actividad');
    const days = RANGE_DAYS[params.range] || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await d.StaffActivityLog.find({ company_id: identity.mongoId, createdAt: { $gte: since } })
      .select('summary actor createdAt')
      .sort({ createdAt: -1 })
      .limit(params.limit)
      .lean();
    return {
      data: {
        range: params.range,
        count: rows.length,
        activity: rows.map((r) => ({
          summary: r.summary || null,
          actor: r?.actor?.name || r?.actor?.email || null,
          at: iso(r.createdAt),
        })),
      },
      answer:
        rows.length === 0
          ? `No hay actividad registrada en los ultimos ${days} dias.`
          : `He encontrado **${rows.length}** movimiento${rows.length === 1 ? '' : 's'} en los ultimos ${days} dias.`,
    };
  },
};

/**
 * Cuando la compañia no cruza de SQL a Mongo. Se dice, no se rellena con ceros:
 * un cero afirma que no hay nada, y lo que pasa es que no lo sabemos.
 */
const unknownCompany = (what) => ({
  data: null,
  answer: `No puedo resolver ${what} de tu compañia ahora mismo. Esta registrada en el inventario pero no encuentro su ficha; avisa a soporte.`,
});

// ───────────────────────────────────────────────────────── auditoria ─────────

/**
 * La fila de auditoria se escribe ANTES de responder y SIN encolar.
 *
 * Es la misma regla que el console de plataforma (helpers/platformAuditLog.js):
 * una lectura que no deja constancia no se sirve. `logStaffActivity` encola y
 * reintenta, que esta bien para una escritura cuyo efecto ya ocurrio; aqui el
 * efecto ES la lectura, asi que si no se puede registrar, no se entrega.
 *
 * Se guarda QUE se pregunto y QUE se leyo, nunca el resultado. Es un registro de
 * acceso, no una copia de los datos.
 */
async function writeAuditRow(d, { request, identity, choice, question, outcome }) {
  await d.StaffActivityLog.create({
    staff_member_id: request.uid || null,
    actor_type: 'staff',
    actor: { name: request.name || null, email: request.email || null },
    summary: `Asistente: ${question ? question.label : 'pregunta fuera del catalogo'}`,
    target_label: choice.question_id,
    display: {
      source: 'assistant',
      question_id: choice.question_id,
      resource: question ? question.resource : null,
      params: choice.params,
      outcome,
      // El texto de la pregunta NO se guarda. Puede llevar datos personales y
      // su retencion es una decision aparte (GovRAMP), no un efecto secundario
      // de construir el endpoint.
    },
    company_id: identity.mongoId,
    company_sql_id: String(identity.sqlId),
  });
}

// ─────────────────────────────────────────────────────────── handler ─────────

const assistantAsk = (deps) => async (request, response) => {
  const d = withDeps(deps);

  try {
    const lengthCheck = checkQuestionLength(request.body?.question);
    if (!lengthCheck.ok) {
      return response.status(400).json({ ok: false, msg: lengthCheck.msg });
    }

    // La compañia y el alcance salen de aqui, no del cuerpo. Devuelve 400/401/403
    // ya redactados; se reenvian tal cual para no inventar un vocabulario nuevo.
    const context = await d.resolveCompanyContextFn(request);
    if (!context.ok) {
      return response.status(context.status).json({ ok: false, msg: context.msg });
    }

    const choice = validateChoice(matchQuestion(request.body.question));
    const question = questionById(choice.question_id);
    const identity = await resolveCompanyIdentity(d, context.companyId);

    if (choice.question_id === UNSUPPORTED || !question) {
      // Un "no se" tambien se audita: estas son las preguntas que el catalogo no
      // cubre, y esa lista es la unica evidencia de que le falta.
      await writeAuditRow(d, { request, identity, choice, question: null, outcome: 'unsupported' });
      return response.status(200).json({
        ok: true,
        question_id: UNSUPPORTED,
        answer: 'No se contestar eso todavia. Esto es lo que si puedo mirar:',
        data: null,
        catalog: catalogOffer(),
      });
    }

    const { data, answer } = await resolvers[choice.question_id]({
      d,
      identity,
      access: context.access,
      params: choice.params,
    });

    await writeAuditRow(d, { request, identity, choice, question, outcome: 'answered' });

    return response.status(200).json({
      ok: true,
      question_id: choice.question_id,
      answer,
      data,
      // Que la respuesta es PARCIAL hay que decirlo. Un rol scoped por categoria
      // ve una cifra mas baja que la real y, sin este aviso, leeria su propia
      // ceguera como un dato. Es el motivo por el que el dashboard retiro la
      // pastilla de Overdue: una cifra que no puede subir enseña a confiar en
      // que no hay nada.
      scope: {
        scoped: Boolean(context.access?.scoped),
        roleType: context.access?.role_type ?? null,
      },
      params: choice.params,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: 'The assistant could not answer this question.',
    });
  }
};

/** GET /api/assistant/catalog — lo que el asistente sabe mirar. */
const assistantCatalog = async (_request, response) =>
  response.status(200).json({ ok: true, data: catalogOffer() });

module.exports = { assistantAsk, assistantCatalog, resolveCompanyIdentity, resolvers };
