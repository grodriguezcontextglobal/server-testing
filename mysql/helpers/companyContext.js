'use strict';

const { getStaffCompanyAccess } = require('./staffAccess');

/**
 * Resolves WHICH company a request is acting on, and proves the caller is
 * actually part of it.
 *
 * The company id is read from the `s-company-lq` header that the client already
 * sends on every request (falling back to body/query for call sites that
 * haven't moved yet). That is a convenience, not a security boundary: a header
 * is supplied by the client exactly like a body field, so `s-company-lq: 999`
 * is no more trustworthy than `{"company_id": 999}`.
 *
 * The trust comes from `getStaffCompanyAccess`, which only returns a row when
 * the caller is an ACTIVE member of that company. Anything else is a 403. This
 * is the single place that decision lives — controllers ask for a context and
 * either get a verified company id or an error to return.
 *
 * `req.sqlStaffId` comes only from the signed JWT. Until 2026-10-21
 * `middlewares/validate-jwt.js` fell back to the client-supplied `s-token-lq`
 * header for tokens without it, which made this identity self-declared.
 */

const COMPANY_HEADER = 's-company-lq';

const readHeader = (req, name) => {
  if (typeof req.header === 'function') return req.header(name);
  return req.headers?.[name];
};

/**
 * @returns {{ok: true, companyId: string, access: object}
 *          | {ok: false, status: number, msg: string}}
 */
const resolveCompanyContext = async (
  req,
  { getStaffCompanyAccessFn = getStaffCompanyAccess } = {}
) => {
  const companyId =
    readHeader(req, COMPANY_HEADER) ||
    req.body?.company_id ||
    req.query?.company_id ||
    null;

  if (!companyId) {
    return {
      ok: false,
      status: 400,
      msg: `Company context is required (send the ${COMPANY_HEADER} header).`,
    };
  }

  if (!req.sqlStaffId) {
    return {
      ok: false,
      status: 401,
      msg: 'No staff identity on this request.',
    };
  }

  const access = await getStaffCompanyAccessFn(req.sqlStaffId, companyId);
  if (!access) {
    return {
      ok: false,
      status: 403,
      msg: 'Not an active staff member of this company.',
    };
  }

  return { ok: true, companyId, access };
};

module.exports = { resolveCompanyContext, COMPANY_HEADER };
