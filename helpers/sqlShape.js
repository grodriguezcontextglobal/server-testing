'use strict';

const crypto = require('crypto');

/**
 * Utilities to describe a SQL statement by its SHAPE, never by its values.
 *
 * Built to inventory what the frontend actually sends to
 * /inventory-based-on-submitted-parameters (the endpoint that executes
 * client-supplied SQL), so a server-side named-query catalog can replace it
 * without breaking calls nobody remembered existed.
 *
 * DELIBERATELY VALUE-FREE: literals are stripped before anything is hashed or
 * returned. Those values carry PII (staff emails, member names, serials), and
 * an audit log is not a place to leak what the endpoint itself is being
 * hardened to protect.
 */

/**
 * Collapses a statement to a comparable shape:
 *   - string literals            -> ?
 *   - IN (...) lists of any size -> IN (?)
 *   - all whitespace runs        -> single space
 *
 * The IN collapsing is the important part: the frontend interpolates
 * variable-length lists directly into the SQL, so the same logical query
 * arrives as a different string on every call and would otherwise look like
 * hundreds of distinct shapes.
 *
 * Numeric constants outside IN lists are intentionally NOT normalized:
 * `warehouse = 1` and `warehouse = 0` are different queries worth cataloguing
 * separately, and keeping them distinct errs toward over-reporting rather than
 * silently merging two call sites into one catalog entry.
 */
const normalizeSqlShape = (sql) => {
  if (typeof sql !== 'string') return '';
  return sql
    // Single-quoted literals, tolerating the '' escape form.
    .replace(/'(?:[^']|'')*'/g, '?')
    // IN (...) -> IN (?), but leave IN (SELECT ...) subqueries intact, since
    // collapsing those would erase the second table from the shape.
    .replace(/\bIN\s*\(\s*(?!select\b)[^)]*\)/gi, 'IN (?)')
    .replace(/\s+/g, ' ')
    .trim();
};

const hashShape = (shape) =>
  crypto.createHash('sha1').update(String(shape).toLowerCase()).digest('hex').slice(0, 12);

const STATEMENT_TYPE =
  /^\s*(select|insert|update|delete|replace|drop|alter|truncate|create|grant|revoke|set|show)\b/i;

const TABLE_REFERENCE = /\b(?:from|join|into|update)\s+`?([a-z0-9_]+)`?/gi;

/**
 * Returns a value-free description of a statement, suitable for logging.
 *
 * `hasCompanyId` is the field that matters most for the migration: a shape
 * without it cannot be scoped to the caller's company, so it is a cross-tenant
 * read (or write) waiting to happen and needs a catalog entry that injects the
 * scope server-side.
 */
const describeSqlShape = (sql) => {
  const shape = normalizeSqlShape(sql);
  const typeMatch = shape.match(STATEMENT_TYPE);
  const tables = [
    ...new Set(
      [...shape.matchAll(TABLE_REFERENCE)].map((match) => match[1].toLowerCase())
    ),
  ];

  return {
    shape,
    hash: hashShape(shape),
    type: typeMatch ? typeMatch[1].toUpperCase() : 'UNKNOWN',
    tables,
    hasCompanyId: /\bcompany_id\s*=/i.test(shape),
  };
};

module.exports = { normalizeSqlShape, hashShape, describeSqlShape };
