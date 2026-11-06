'use strict';

/**
 * Topes del plan de suscripción (2026-11-06; ver constants/subscriptionPlans.js
 * y reports/FRONTEND_subscription_plans_update_2026-11-06.md §4).
 *
 * UNA sola puerta para todas las escrituras que añaden staff o inventario:
 *
 *   withPlanCapacity({ resource, sqlCompanyId, requested, context }, fn)
 *     toma el candado de la compañía y ese recurso, cuenta, decide y, si pasa,
 *     corre `fn` (la escritura) SIN soltar el candado: así dos altas simultáneas
 *     no pasan las dos con el mismo conteo. El conteo se hace con el pool (lectura
 *     autocommit), no dentro de la transacción de quien llama: una lectura dentro
 *     de una transacción ya empezada vería su foto vieja, no lo que el anterior
 *     dueño del candado acaba de confirmar.
 *
 *   precheckPlanCapacity(...)
 *     lo mismo sin candado, para los controladores que encolan: responden 403 al
 *     momento en el caso normal. La puerta real es el handler del job, que vuelve
 *     a comprobar con withPlanCapacity.
 *
 * PLAN_LIMITS_MODE (lazy, como el resto de modos):
 *   warn    (defecto) deja pasar y registra lo que habría rechazado;
 *   enforce rechaza con 403 PLAN_LIMIT_REACHED;
 *   off     no comprueba nada.
 *
 * Los topes se aplican sobre el id SQL de la compañía: staff = company_staff
 * activo, items = item_inv. El plan se busca en CompanySubscription por
 * sql_company_id; sin fila, la compañía es Free.
 */

const logger = require('./logger');
const {
  PLAN_LIMITS,
  PLAN_NAMES,
  PAID_STATUSES,
  RESOURCES,
} = require('../constants/subscriptionPlans');

const mode = () => String(process.env.PLAN_LIMITS_MODE || 'warn').toLowerCase();

const PLAN_LIMIT_CODE = 'PLAN_LIMIT_REACHED';

const COUNT_QUERIES = Object.freeze({
  staff: 'SELECT COUNT(*) AS n FROM company_staff WHERE company_id = ? AND is_active = 1',
  items: 'SELECT COUNT(*) AS n FROM item_inv WHERE company_id = ?',
});

const RESOURCE_LABELS = Object.freeze({ staff: 'staff members', items: 'inventory items' });

// ── Dependencias reales, perezosas (los tests inyectan las suyas) ────────────
// Sin conexión a Mongo, mongoose encola la consulta y espera 10 s antes de
// fallar: la comprobación del plan no puede colgar una escritura ese tiempo.
const requireMongo = () => {
  if (require('mongoose').connection.readyState !== 1) throw new Error('mongo not connected');
};

const realDeps = () => ({
  query: (sql, params) => require('../mysql/database/config')().query(sql, params),
  findSubscription: async (filter) => {
    requireMongo();
    return require('../models/CompanySubscription').findOne(filter).lean();
  },
  findCompanyByName: async (name) => {
    requireMongo();
    return require('../models/Company').findOne({ company_name: name }, { _id: 1 }).lean();
  },
  acquireLock: (key, opts) => require('./companyLock').acquireLock(key, opts),
  logActivity: (data) => require('../controller/staffActivityLog').logStaffActivity(data),
});

const withDeps = (deps) => ({ ...realDeps(), ...(deps || {}) });

/**
 * Plan efectivo de una fila (o de su ausencia). Una Pro que dejó de pagar
 * (canceled, unpaid, incomplete...) vuelve a los topes de Free; Enterprise no
 * depende de Stripe.
 */
function effectivePlan(record) {
  if (!record || !record.plan) return 'free';
  if (record.plan === 'pro' && !PAID_STATUSES.has(record.status)) return 'free';
  return PLAN_LIMITS[record.plan] ? record.plan : 'free';
}

/**
 * Topes efectivos: override por compañía ?? tope del plan. null = sin tope.
 * Una cuenta demo no tiene topes, con overrides o sin ellos.
 */
function effectiveLimits(record) {
  if (record?.demo) return Object.fromEntries(RESOURCES.map((r) => [r, null]));
  const plan = effectivePlan(record);
  const base = PLAN_LIMITS[plan];
  const overrides = record?.limit_overrides || {};
  const out = {};
  for (const resource of RESOURCES) {
    const override = overrides[resource];
    out[resource] = Number.isFinite(override) ? override : base[resource];
  }
  return out;
}

const toSqlId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function getSubscriptionForSqlCompany(sqlCompanyId, deps) {
  const d = withDeps(deps);
  const id = toSqlId(sqlCompanyId);
  if (!id) return null;
  return d.findSubscription({ sql_company_id: id });
}

async function countUsage(resource, sqlCompanyId, deps) {
  const d = withDeps(deps);
  const sql = COUNT_QUERIES[resource];
  if (!sql) throw new Error(`unknown plan resource: ${resource}`);
  const [rows] = await d.query(sql, [sqlCompanyId]);
  return Number(rows?.[0]?.n ?? 0);
}

/** id SQL de una compañía de Mongo (mismo cruce por nombre que registration.js). */
async function resolveSqlCompanyId(companyName, deps) {
  if (!companyName) return null;
  const d = withDeps(deps);
  const [rows] = await d.query(
    'SELECT company_id FROM company_info WHERE company_name = ? LIMIT 1',
    [companyName]
  );
  return toSqlId(rows?.[0]?.company_id);
}

/** id Mongo de una compañía SQL, para el audit trail de un rechazo. */
async function resolveMongoCompanyId(sqlCompanyId, deps) {
  const d = withDeps(deps);
  try {
    const [rows] = await d.query(
      'SELECT company_name FROM company_info WHERE company_id = ? LIMIT 1',
      [sqlCompanyId]
    );
    const name = rows?.[0]?.company_name;
    if (!name) return null;
    const company = await d.findCompanyByName(name);
    return company?._id ? String(company._id) : null;
  } catch {
    return null;
  }
}

function buildRefusal({ resource, plan, limit, current, requested }) {
  const fits = Math.max(0, limit - current);
  const planName = PLAN_NAMES[plan] || plan;
  const label = RESOURCE_LABELS[resource];
  const msg =
    resource === 'items' && requested > 1
      ? `Your ${planName} plan includes up to ${limit.toLocaleString('en-US')} ${label}. ` +
        `You have ${current.toLocaleString('en-US')}, so ${fits.toLocaleString('en-US')} of these ` +
        `${requested.toLocaleString('en-US')} fit. Upgrade to add more.`
      : `Your ${planName} plan includes up to ${limit.toLocaleString('en-US')} ${label}. Upgrade to add more.`;
  return {
    ok: false,
    code: PLAN_LIMIT_CODE,
    resource,
    limit,
    current,
    requested,
    fits,
    plan,
    msg,
  };
}

/**
 * Cuenta y decide, sin candado. Devuelve { refusal } (null si cabe o si el modo
 * no rechaza) y deja registrado lo que corresponda al modo.
 */
async function evaluateCapacity(args, deps) {
  if (mode() === 'off') return { refusal: null };
  try {
    return await decideCapacity(args, deps);
  } catch (error) {
    // El tope es una regla de negocio, no un control de acceso: si no se puede
    // contar (Mongo o SQL caídos), la escritura sigue y queda constancia. Lo
    // contrario dejaría a todas las compañías sin poder dar de alta nada.
    logger.error('plan limits: check failed, allowing the write', {
      resource: args?.resource,
      sql_company_id: args?.sqlCompanyId,
      error: error.message,
    });
    return { refusal: null };
  }
}

async function decideCapacity({ resource, sqlCompanyId, requested = 1, context = {} }, deps) {
  const currentMode = mode();

  const d = withDeps(deps);
  const id = toSqlId(sqlCompanyId);
  if (!id) return { refusal: null }; // sin compañía resuelta, el resto de la ruta ya decide
  // requested 0 (un import cuyas filas ya existían todas) no añade nada.
  const need = requested === undefined ? 1 : Number(requested);
  if (!Number.isFinite(need) || need <= 0) return { refusal: null };

  const record = await getSubscriptionForSqlCompany(id, d);
  const plan = effectivePlan(record);
  const limit = effectiveLimits(record)[resource];
  if (limit === null || limit === undefined) return { refusal: null };

  const current = await countUsage(resource, id, d);
  if (current + need <= limit) return { refusal: null };

  const refusal = buildRefusal({ resource, plan, limit, current, requested: need });
  const detail = {
    sql_company_id: id,
    resource,
    plan,
    limit,
    current,
    requested: need,
    route: context.route,
    uid: context.uid,
  };

  if (currentMode !== 'enforce') {
    logger.warn(`plan limits: would refuse ${resource} (PLAN_LIMITS_MODE=warn)`, detail);
    return { refusal: null };
  }

  logger.warn(`plan limits: refused ${resource}`, detail);
  // AU-2: soporte necesita los rechazos para contestar "¿por qué no puedo añadir staff?".
  const companyId = record?.company ? String(record.company) : await resolveMongoCompanyId(id, d);
  await d.logActivity({
    staff_member_id: context.uid || null,
    actor_type: context.uid ? 'staff' : 'anonymous',
    company_id: companyId,
    action: 'PLAN_LIMIT_REACHED',
    target_model: 'Subscription',
    target_id: companyId,
    details: detail,
    ip_address: context.ip,
  });
  return { refusal };
}

const lockKey = (resource, sqlCompanyId) => `plan-limit:${resource}:${sqlCompanyId}`;

const noop = async () => {};

/**
 * Toma el candado y comprueba. Si cabe, devuelve { refusal: null, release } y
 * el candado sigue tomado hasta que quien llama ejecute `release()` (después de
 * escribir). Si no cabe, devuelve { refusal } con el candado ya suelto.
 * Para flujos que no caben en un callback (controller/registration.js).
 */
async function reservePlanCapacity(args, deps) {
  // Nada que añadir (requested 0) no necesita ni candado ni conteo.
  if (mode() === 'off' || !toSqlId(args.sqlCompanyId) || Number(args.requested) === 0) {
    return { refusal: null, release: noop };
  }
  const d = withDeps(deps);
  let release = noop;
  try {
    release = await d.acquireLock(lockKey(args.resource, toSqlId(args.sqlCompanyId)), args.lockOptions);
  } catch (error) {
    // Sin Redis no se bloquea la operación: se comprueba igual, sin candado, y
    // queda constancia (una carrera puede colar una fila de más).
    logger.error('plan limits: lock unavailable, checking without it', {
      resource: args.resource,
      sql_company_id: args.sqlCompanyId,
      error: error.message,
    });
  }
  try {
    const { refusal } = await evaluateCapacity(args, d);
    if (refusal) {
      await release();
      return { refusal, release: noop };
    }
    return { refusal: null, release };
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * Comprueba bajo candado y, si cabe, corre `fn` sin soltarlo.
 * @returns {Promise<{ refusal: object } | { result: any }>}
 */
async function withPlanCapacity(args, fn, deps) {
  const { refusal, release } = await reservePlanCapacity(args, deps);
  if (refusal) return { refusal };
  try {
    return { result: await fn() };
  } finally {
    await release();
  }
}

/** Sin candado: para responder 403 antes de encolar. */
async function precheckPlanCapacity(args, deps) {
  const { refusal } = await evaluateCapacity(args, deps);
  return refusal;
}

const isPlanRefusal = (value) => Boolean(value && value.code === PLAN_LIMIT_CODE);

/** Contexto para el registro de un rechazo, desde un request de Express. */
const planContextFromRequest = (req) => ({
  route: req ? `${req.method} ${req.baseUrl || ''}${req.path || ''}` : undefined,
  uid: req?.uid,
  ip: req?.ip,
});

/** Lo mismo desde un job de la cola (el uid viaja en job.context). */
const planContextFromJob = (job, route) => ({
  route: route || job?.type,
  uid: job?.context?.uid,
  ip: job?.context?.ip,
});

// Los bulk tardan: el candado tiene que durar lo que la inserción entera y la
// espera, lo que tarde otro import de la misma compañía.
const BULK_LOCK_OPTIONS = Object.freeze({ ttlMs: 10 * 60_000, waitMs: 5 * 60_000 });

module.exports = {
  mode,
  PLAN_LIMIT_CODE,
  COUNT_QUERIES,
  effectivePlan,
  effectiveLimits,
  getSubscriptionForSqlCompany,
  countUsage,
  resolveSqlCompanyId,
  resolveMongoCompanyId,
  buildRefusal,
  evaluateCapacity,
  reservePlanCapacity,
  withPlanCapacity,
  precheckPlanCapacity,
  isPlanRefusal,
  planContextFromRequest,
  planContextFromJob,
  BULK_LOCK_OPTIONS,
  lockKey,
};
