const { Schema, model } = require("mongoose");
const { PLANS, SUBSCRIPTION_STATUSES, CHECKOUT_INTERVALS } = require("../constants/subscriptionPlans");

/**
 * El plan de una compañía (2026-11-06). Una fila por compañía; sin fila = Free.
 *
 * En su propia colección y NO como campos de Company a propósito:
 * PATCH /api/company/update-company/:id hace findByIdAndUpdate con el body, y un
 * campo `plan` en Company sería un plan que el dashboard podría escribirse a
 * sí mismo. Aquí solo escriben el webhook de Stripe (controller/stripeWebhook.js)
 * y un super_user con scripts/set-company-plan.js.
 *
 * `sql_company_id` es la clave con la que se aplican los topes: staff e
 * inventario viven en SQL (company_staff, item_inv), y Mongo y SQL no comparten
 * id; se resuelve por company_name al crear la fila (helpers/planLimits.js).
 */
const limitValue = { type: Number, min: 0, default: undefined };

const CompanySubscriptionSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    sql_company_id: { type: Number, default: null, index: true },
    plan: { type: String, enum: PLANS, default: "free" },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: "active" },
    interval: { type: String, enum: [...CHECKOUT_INTERVALS, null], default: null },
    current_period_end: { type: Date, default: null },
    cancel_at_period_end: { type: Boolean, default: false },
    // La prueba de 30 días se da una vez por compañía, no en cada alta.
    trial_used: { type: Boolean, default: false },
    // Cuenta de demostración (2026-11-06, decisión de Gustavo): sigue en el
    // plan Free, pero SIN topes de staff ni de inventario. La marca un
    // super_user con scripts/set-company-plan.js --demo on; Stripe no la toca.
    demo: { type: Boolean, default: false },
    stripe_customer_id: { type: String, default: null },
    stripe_subscription_id: { type: String, default: null, index: true },
    limit_overrides: {
      type: new Schema({ staff: limitValue, items: limitValue }, { _id: false }),
      default: null,
    },
    // Último evento de Stripe aplicado: su id (idempotencia) y su `created`
    // (orden: un evento más viejo que el aplicado no pisa el estado).
    updated_by_event: { type: String, default: null },
    stripe_event_created: { type: Number, default: null },
    // Quién la cambió por última vez fuera de Stripe (super_user).
    updated_by_user: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { timestamps: true }
);

module.exports = model("CompanySubscription", CompanySubscriptionSchema);
