'use strict';

/**
 * Qué puede cambiar PATCH /api/company/update-company/:id (AC-6; 2026-11-09).
 *
 * Antes el controlador hacía `findByIdAndUpdate(id, { ...req.body })`: cualquier
 * staff con company:update podía escribir cualquier campo de Company, incluidos
 * `stripe_customer_id`, `owner` o el `stripe_connected_account` (a qué cuenta de
 * Stripe se cobra).
 *
 * Ahora solo pasan los campos de esta lista. Lo demás se IGNORA, no se rechaza:
 * una pantalla del dashboard (Inventario → filtros) manda la compañía entera
 * de la sesión más el campo que cambia, y rechazar la petición la rompería.
 * Lo ignorado se devuelve en `ignored_fields` y queda en el log.
 *
 * `employees` sigue en la lista solo hasta que el dashboard deje de escribir la
 * plantilla por aquí (cerrar eventos ya va por /event-staff/deactivate).
 *
 * `stripe_connected_account` es especial: la cuenta la crea y la guarda el
 * servidor (controller/stripe.js → persistConnectedAccountId). El dashboard
 * vuelve a escribirla con otra forma (`{ id, login_links }` en vez del `acct_`
 * suelto), y de eso depende que la vea. Se acepta ese cambio de FORMA, pero
 * nunca un `acct_` distinto del que ya está guardado para ese entorno.
 */

const COMPANY_EDITABLE_FIELDS = Object.freeze(new Set([
  'company_name',
  'address',
  'phone',
  'website',
  'main_email',
  'industry',
  'company_logo',
  'email_branding',
  'structure',
  'roleLabels',
  'employees', // temporal: ver la cabecera
]));

const ENVIRONMENTS = ['test', 'live'];

/** El acct_ de un valor guardado o enviado (cadena suelta u objeto con id). */
const accountIdOf = (value) => {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? value.id : null;
  return typeof raw === 'string' && raw.trim().startsWith('acct_') ? raw.trim() : null;
};

/**
 * El stripe_connected_account que se puede guardar, o null si no cambia nada.
 * Por entorno: solo se acepta el MISMO acct_ que ya hay guardado (cambio de
 * forma). Uno distinto, uno nuevo donde no había, o borrarlo, se ignoran.
 */
function sanitizeConnectedAccount(sent, stored) {
  if (!sent || typeof sent !== 'object' || Array.isArray(sent)) return { value: null, rejected: true };
  if (!ENVIRONMENTS.some((env) => env in sent)) return { value: null, rejected: true };

  const current = stored && typeof stored === 'object' ? stored : {};
  const next = { test: current.test ?? null, live: current.live ?? null };
  let changed = false;
  let rejected = false;

  for (const env of ENVIRONMENTS) {
    if (!(env in sent)) continue;
    const sentId = accountIdOf(sent[env]);
    const storedId = accountIdOf(current[env]);
    if (sentId && sentId === storedId) {
      const login_links =
        sent[env] && typeof sent[env] === 'object' && sent[env].login_links && typeof sent[env].login_links === 'object'
          ? sent[env].login_links
          : undefined;
      next[env] = login_links ? { id: sentId, login_links } : { id: sentId };
      changed = true;
    } else if (sentId !== storedId) {
      rejected = true;
    }
  }
  return { value: changed ? next : null, rejected };
}

/**
 * @param {object} body  request.body
 * @param {object} company  el documento actual (para stripe_connected_account)
 * @returns {{ update: object, ignored: string[] }}
 */
function pickCompanyUpdate(body, company) {
  const update = {};
  const ignored = [];
  for (const [key, value] of Object.entries(body && typeof body === 'object' ? body : {})) {
    if (COMPANY_EDITABLE_FIELDS.has(key)) {
      update[key] = value;
    } else if (key === 'stripe_connected_account') {
      const { value: account, rejected } = sanitizeConnectedAccount(value, company?.stripe_connected_account);
      if (account) update.stripe_connected_account = account;
      if (rejected) ignored.push(key);
    } else {
      ignored.push(key);
    }
  }
  return { update, ignored };
}

module.exports = { COMPANY_EDITABLE_FIELDS, pickCompanyUpdate, sanitizeConnectedAccount, accountIdOf };
