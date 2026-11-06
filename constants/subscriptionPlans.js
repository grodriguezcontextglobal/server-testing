'use strict';

/**
 * Planes de suscripción por compañía (2026-11-06,
 * reports/FRONTEND_subscription_plans_update_2026-11-06.md).
 *
 * ESTA es la fuente de verdad de los topes; el dashboard guarda una copia solo
 * para pintar. Cambiar un tope es cambiar este objeto: todas las escrituras que
 * lo aplican pasan por helpers/planLimits.js.
 *
 * Decisiones (Gustavo, 2026-11-06):
 *   - staff = todo miembro ACTIVO de la compañía (SQL company_staff.is_active = 1),
 *     admin y roles con alcance incluidos;
 *   - items = TODO el inventario de la compañía (item_inv, sin filtrar estado:
 *     la tabla no tiene estado y los borrados son físicos);
 *   - Pro lleva 30 días de prueba en Checkout;
 *   - las compañías que ya superan Free se deciden con el conteo del modo warn
 *     (scripts/plan-usage-report.js).
 */

const PLANS = Object.freeze(['free', 'pro', 'enterprise']);

// null = sin tope (salvo override por compañía).
const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({ staff: 3, items: 1000 }),
  pro: Object.freeze({ staff: 10, items: 4000 }),
  enterprise: Object.freeze({ staff: null, items: null }),
});

const PLAN_NAMES = Object.freeze({ free: 'Free', pro: 'Pro', enterprise: 'Enterprise' });

const RESOURCES = Object.freeze(['staff', 'items']);

const SUBSCRIPTION_STATUSES = Object.freeze([
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'paused',
]);

// Estados de Stripe en los que una compañía Pro conserva los topes de Pro.
// past_due incluido: dura lo que la ventana de reintentos de Stripe (Smart
// Retries); al agotarse, Stripe pasa la suscripción a canceled o unpaid y el
// webhook la devuelve a los topes de Free.
const PAID_STATUSES = Object.freeze(new Set(['active', 'trialing', 'past_due']));

const CHECKOUT_INTERVALS = Object.freeze(['month', 'year']);

// Price ids desde la config del servidor, nunca desde el request.
const PRICE_ENV = Object.freeze({
  month: 'STRIPE_PRICE_PRO_MONTH',
  year: 'STRIPE_PRICE_PRO_YEAR',
});

const DEFAULT_TRIAL_DAYS = 30;

const trialDays = () => {
  const raw = process.env.SUBSCRIPTION_TRIAL_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_TRIAL_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_TRIAL_DAYS;
};

const ADMIN_BASE_URL = () =>
  String(process.env.FRONTEND_URL || 'https://admin.devitrak.net').replace(/\/+$/, '');

module.exports = {
  PLANS,
  PLAN_LIMITS,
  PLAN_NAMES,
  RESOURCES,
  SUBSCRIPTION_STATUSES,
  PAID_STATUSES,
  CHECKOUT_INTERVALS,
  PRICE_ENV,
  DEFAULT_TRIAL_DAYS,
  trialDays,
  ADMIN_BASE_URL,
};
