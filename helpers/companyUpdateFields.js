'use strict';

const { VALID_ROLE_TYPES_LIST } = require('../mysql/constants/roles');

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
 * `employees` SALIÓ de la lista el 2026-11-17 (AC-2). Era el último hueco por el
 * que se podía reescribir la plantilla entera de staff —roles y `super_user`
 * incluidos— desde una ruta de edición de datos de compañía. El dashboard
 * confirmó que desde su #86 el cierre de evento va por
 * POST /api/company/event-staff/deactivate y que la ruta vieja solo era un
 * fallback.
 *
 * Y VOLVIÓ EL 2026-11-18, SANEADO, porque la frase que escribí entonces —"las
 * altas y bajas de staff tienen sus propias rutas; esta no"— era falsa a
 * medias y rompió producción. La BAJA sí tiene la suya. El ALTA no tenía
 * ninguna: dar de alta a alguien es crear su entrada `Pending` en
 * `employees`, y eso solo se podía hacer por aquí. Sin ella,
 * `POST /api/nodemailer/new_invitation` responde "There is no pending
 * invitation for … in this company" (controller/registration.js:498) y el
 * alta de staff se queda sin primer paso.
 *
 * Lo que se acepta ahora es sólo AÑADIR una persona nueva, y con los campos
 * que decide el servidor:
 *
 *   - una entrada cuyo email no esté ya en la compañía se añade con
 *     `status: 'Pending'`, `super_user: false` y `active: true` FORZADOS, y
 *     con `roleType` sólo si está en la lista de roles válidos;
 *   - las entradas que ya existen se dejan EXACTAMENTE como están: lo que
 *     venga en el cuerpo sobre ellas se ignora;
 *   - quitar a alguien tampoco se puede desde aquí: una entrada ausente del
 *     cuerpo no se borra.
 *
 * Así el hueco de AC-2 sigue cerrado —nadie se asciende a `super_user` ni se
 * cambia el rol por esta ruta— y el alta vuelve a funcionar sin que el
 * dashboard cambie nada, porque manda la plantilla entera y aquí se le coge
 * sólo lo nuevo.
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

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const asText = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * La plantilla que se puede guardar, o null si no cambia nada.
 *
 * SOLO AÑADE. Las entradas existentes se copian tal cual desde `stored`, así
 * que lo que el cuerpo diga sobre ellas da igual: ni rol, ni `super_user`, ni
 * `active`, ni borrarlas. Lo único que puede entrar es una persona cuyo email
 * no esté ya, y con los campos que decide el servidor.
 *
 * @param {unknown} sent    body.employees
 * @param {Array}   stored  company.employees actual
 * @returns {{ value: object[]|null, rejected: boolean, added: string[] }}
 *          `rejected` = venía algo que se descartó (una modificación, una baja
 *          o un alta mal formada), para que el llamante lo ponga en
 *          `ignored_fields` y quede en el log.
 */
function sanitizeEmployees(sent, stored) {
  if (!Array.isArray(sent)) return { value: null, rejected: true, added: [] };

  const current = Array.isArray(stored) ? stored : [];
  // Las existentes se identifican por email, que es la clave que usa el resto
  // del flujo de invitación (registration.js busca por `e.user`).
  const existing = new Set(current.map((e) => normalizeEmail(e?.user)));

  const added = [];
  let rejected = false;

  for (const entry of sent) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { rejected = true; continue; }
    const email = normalizeEmail(entry.user);
    if (!email) { rejected = true; continue; }

    if (existing.has(email)) {
      // Ya está: cualquier cosa que venga sobre ella se descarta en silencio,
      // salvo que venga IDÉNTICA, que es el caso normal (el dashboard manda la
      // plantilla entera). Sólo se marca `rejected` si intentaba cambiarla.
      const stale = current.find((e) => normalizeEmail(e?.user) === email);
      if (changesExisting(entry, stale)) rejected = true;
      continue;
    }
    if (added.includes(email)) { rejected = true; continue; } // duplicada en el mismo cuerpo

    const roleType = asText(entry.roleType);
    if (!VALID_ROLE_TYPES_LIST.includes(roleType)) { rejected = true; continue; }

    added.push(email);
  }

  if (!added.length) return { value: null, rejected, added: [] };

  const additions = added.map((email) => {
    const entry = sent.find((e) => normalizeEmail(e?.user) === email);
    return {
      user: asText(entry.user),
      firstName: asText(entry.firstName),
      lastName: asText(entry.lastName),
      employee_id: '',
      // Los tres los decide el servidor, no el cuerpo. Es lo que mantiene
      // cerrado AC-2: por esta ruta nadie nace con poder.
      status: 'Pending',
      super_user: false,
      active: true,
      roleType: asText(entry.roleType),
      preference: { inventory_location: [], managerLocation: [] },
    };
  });

  // Las existentes se copian del documento, NO del cuerpo.
  return { value: [...current, ...additions], rejected, added };
}

/** ¿El cuerpo intentaba cambiar algo de una entrada que ya existe? */
function changesExisting(entry, stored) {
  if (!stored) return false;
  for (const field of ['roleType', 'status', 'active', 'super_user', 'firstName', 'lastName']) {
    if (!(field in entry)) continue;
    const sentValue = typeof entry[field] === 'string' ? entry[field].trim() : entry[field];
    const storedValue = typeof stored[field] === 'string' ? stored[field].trim() : stored[field];
    if (sentValue !== storedValue) return true;
  }
  return false;
}

/**
 * @param {object} body  request.body
 * @param {object} company  el documento actual (para stripe_connected_account
 *                          y para la plantilla de staff)
 * @returns {{ update: object, ignored: string[], addedEmployees: string[] }}
 */
function pickCompanyUpdate(body, company) {
  const update = {};
  const ignored = [];
  let addedEmployees = [];
  for (const [key, value] of Object.entries(body && typeof body === 'object' ? body : {})) {
    if (COMPANY_EDITABLE_FIELDS.has(key)) {
      update[key] = value;
    } else if (key === 'stripe_connected_account') {
      const { value: account, rejected } = sanitizeConnectedAccount(value, company?.stripe_connected_account);
      if (account) update.stripe_connected_account = account;
      if (rejected) ignored.push(key);
    } else if (key === 'employees') {
      const { value: employees, rejected, added } = sanitizeEmployees(value, company?.employees);
      if (employees) update.employees = employees;
      addedEmployees = added;
      if (rejected) ignored.push(key);
    } else {
      ignored.push(key);
    }
  }
  return { update, ignored, addedEmployees };
}

module.exports = {
  COMPANY_EDITABLE_FIELDS,
  pickCompanyUpdate,
  sanitizeConnectedAccount,
  sanitizeEmployees,
  accountIdOf,
};
