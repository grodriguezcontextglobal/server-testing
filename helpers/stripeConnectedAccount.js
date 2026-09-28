'use strict';

/**
 * A qué cuenta de Stripe se cobra.
 *
 * EL PROBLEMA QUE RESUELVE. Hoy todos los cobros de todas las compañías caen en
 * la cuenta de ContextGlobal, que es la cuenta madre de la plataforma. Las
 * cuentas conectadas se llevan creando desde hace tiempo —a propósito, como
 * trabajo adelantado— pero **el servidor nunca supo cuál es de quién**:
 * `stripeAccountCreate` devolvía el `acct_` al cliente y no lo guardaba, y
 * `connectedAccountId` solo aparecía llegando desde `request.body`.
 *
 * Sin ese mapa no se puede separar nada, y con el `acct_` viniendo del cuerpo
 * de la petición —en rutas que además son públicas— cualquiera podría cobrar
 * contra la cuenta de cualquiera. Por eso la resolución vive AQUÍ, en el
 * servidor, a partir de la compañía, y nunca de lo que mande el cliente.
 *
 * CONTEXTGLOBAL NO ES UN CASO ESPECIAL. Es el caso `null`: una compañía sin
 * cuenta conectada no lleva cabecera, y sin cabecera cobra la cuenta madre —
 * que es la suya. La ausencia de cuenta conectada **es** su configuración
 * correcta, no un apaño temporal.
 *
 * ESTO NO CAMBIA NINGÚN COMPORTAMIENTO ACTUAL. Mientras ninguna compañía tenga
 * `acct_` guardado, `stripeOptionsFor` devuelve `{}` y las llamadas se comportan
 * exactamente igual que hoy. El día que una lo tenga, sus cobros van a su
 * cuenta: es un cambio de dato, no de código.
 *
 * LO QUE ESTE HELPER NO DECIDE, y hay que decidir antes del primer cambio real:
 * el tipo de cargo (directo, con destino, o separados), qué pasa con los
 * `StripeCustomer` existentes —que viven en la cuenta madre y NO viajan con la
 * compañía—, los webhooks de cuenta conectada, y segmentar la clave de
 * idempotencia, que en Stripe es por cuenta. Ver `BACKLOG_stripe_connect.md`.
 */

/**
 * Modo de la clave con la que está configurado el cliente.
 *
 * El `acct_` de una cuenta conectada es DISTINTO en prueba y en producción, y
 * por eso `Company.stripe_connected_account` tiene forma `{ test, live }` desde
 * que se definió el modelo. Derivarlo de la propia clave evita el fallo clásico:
 * guardar el de producción y que un entorno de pruebas intente cobrar contra él.
 */
const stripeModeFromKey = (key = process.env.STRIPE_SECRET_KEY || '') =>
  String(key).startsWith('sk_live_') ? 'live' : 'test';

/**
 * El `acct_` de una compañía, o `null` si no tiene.
 *
 * Acepta el documento de compañía ya cargado; no consulta por su cuenta para
 * que el llamante controle cuándo se va a la base.
 *
 * @param {object|null} company  Documento de Company (o un objeto con la misma forma).
 * @param {object} [opts]
 * @param {'test'|'live'} [opts.mode]  Por defecto, el de la clave en uso.
 */
const resolveConnectedAccountId = (company, { mode = stripeModeFromKey() } = {}) => {
  if (!company) return null;

  const stored = company.stripe_connected_account;
  if (!stored) return null;

  const value = typeof stored === 'object' ? stored[mode] : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  // Solo un identificador de cuenta con la forma correcta. Un valor a medias
  // —cadena vacía, un objeto que alguien guardó entero, un `undefined`
  // serializado— tiene que caer al caso `null` y cobrar en la cuenta madre,
  // nunca provocar una llamada con una cabecera inválida.
  return trimmed.startsWith('acct_') ? trimmed : null;
};

/**
 * Las opciones por petición para el SDK de Stripe.
 *
 * `{}` cuando no hay cuenta conectada — que es lo que mantiene intacto el
 * comportamiento de hoy — y `{ stripeAccount }` cuando la hay.
 *
 * Se usa SIEMPRE, incluso donde hoy siempre da `{}`: el objetivo es que no
 * quede ninguna llamada a Stripe que no haya pasado por esta decisión, porque
 * una convención que hay que acordarse de aplicar ruta a ruta es la que se
 * olvida. Es el mismo razonamiento que movió el límite y la idempotencia al
 * router en `routes/stripe.js`.
 */
const stripeOptionsFor = (accountId) =>
  typeof accountId === 'string' && accountId.startsWith('acct_')
    ? { stripeAccount: accountId }
    : {};

/**
 * Guarda el `acct_` de una compañía, en el modo que corresponda.
 *
 * Conserva el otro modo: una compañía puede tener cuenta de prueba y de
 * producción a la vez, y escribir el objeto entero borraría la otra.
 *
 * @returns {Promise<boolean>} si se guardó
 */
const persistConnectedAccountId = async (
  Company,
  companyId,
  accountId,
  { mode = stripeModeFromKey(), logger } = {}
) => {
  if (!companyId || typeof accountId !== 'string' || !accountId.startsWith('acct_')) {
    return false;
  }

  try {
    // Clave anidada para no pisar el otro modo.
    await Company.updateOne(
      { _id: companyId },
      { $set: { [`stripe_connected_account.${mode}`]: accountId } }
    );
    return true;
  } catch (error) {
    // Que no se pueda guardar el mapa NO puede tumbar la creación de la cuenta:
    // la cuenta ya existe en Stripe en ese punto, y fallar aquí dejaría al
    // cliente creando una segunda. Se registra y se sigue.
    if (logger && typeof logger.error === 'function') {
      logger.error(`stripe: no se pudo guardar la cuenta conectada de ${companyId}: ${error.message}`);
    }
    return false;
  }
};

/**
 * Las opciones de Stripe para ESTE request, resolviendo la compañía en el
 * servidor.
 *
 * Corta antes de ir a la base cuando no hay contexto de compañía, que hoy es la
 * mayoría de las llamadas públicas: sin compañía no hay cuenta conectada
 * posible, así que no hay nada que consultar.
 *
 * Devuelve también el `companyId` porque el llamante lo necesita para la
 * `metadata` del cobro — que es, mientras todo caiga en la cuenta madre, la
 * única forma de saber después de quién era cada pago.
 *
 * @returns {Promise<{options: object, companyId: string|null, accountId: string|null}>}
 */
const resolveStripeContextForRequest = async (
  request,
  { Company, resolveCompany, logger } = {}
) => {
  const companyId = typeof resolveCompany === 'function' ? resolveCompany(request) : null;
  if (!companyId || !Company) return { options: {}, companyId: companyId || null, accountId: null };

  try {
    const company = await Company.findById(companyId).select('stripe_connected_account').lean();
    const accountId = resolveConnectedAccountId(company);
    return { options: stripeOptionsFor(accountId), companyId, accountId };
  } catch (error) {
    // Un fallo leyendo la compañía NO puede impedir un cobro: se cae al
    // comportamiento de hoy —cuenta madre— y se registra.
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`stripe: no se pudo resolver la cuenta conectada de ${companyId}: ${error.message}`);
    }
    return { options: {}, companyId, accountId: null };
  }
};

module.exports = {
  stripeModeFromKey,
  resolveConnectedAccountId,
  stripeOptionsFor,
  persistConnectedAccountId,
  resolveStripeContextForRequest,
};
