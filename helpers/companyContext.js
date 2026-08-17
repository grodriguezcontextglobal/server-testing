'use strict';

/**
 * Resuelve la compañía en cuyo contexto corre este request.
 *
 * La compañía NO se deriva del AdminUser: un mismo usuario pertenece a varias
 * con distintos roles, así que el contexto lo elige el cliente al loguearse y
 * lo manda en cada request (header `x-company-id`, recomendado). Antes este
 * orden de precedencia vivía inline dentro de authorizeMongoPermission; se
 * extrajo cuando los call-sites de auditoría necesitaron exactamente el mismo
 * criterio — si difirieran, un log quedaría atribuido a otra compañía que la
 * que autorizó la operación.
 *
 * Devuelve `null` cuando no hay contexto de compañía. Eso NO es un error: en
 * `/login` la selección todavía no ocurrió, y ese caso es legítimamente
 * pre-selección.
 *
 * @param {object} req  Request de Express (o un objeto con params/body/query/headers).
 * @param {object} [opts]
 * @param {boolean} [opts.headerOnly=false]  Ignora params/body/query y lee SOLO
 *   el header. Para rutas donde el body es contenido enviado por el caller y no
 *   debe poder redefinir la atribución — ver controller/staffActivityLog.js §
 *   createRegisterStaffActivity, cuyo contrato es "nunca del body".
 * @returns {string|null}
 */
function resolveCompanyContext(req, { headerOnly = false } = {}) {
  if (!req) return null;

  const headerCompanyId =
    (typeof req.header === 'function' ? req.header('x-company-id') : undefined) ||
    req.headers?.['x-company-id'];

  if (headerOnly) return headerCompanyId || null;

  return (
    req.params?.company_id ||
    req.body?.company_id ||
    req.query?.company_id ||
    headerCompanyId ||
    null
  );
}

module.exports = { resolveCompanyContext };
