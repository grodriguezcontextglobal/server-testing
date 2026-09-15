'use strict';

/**
 * Los tres handlers que permiten a `/inventory` dejar de descargar el
 * inventario entero:
 *
 *   POST /api/db_item/inventory-page    → una página de la tabla (cursor keyset)
 *   POST /api/db_item/inventory-facets  → total + valores de los filtros (agregados)
 *   GET  /api/db_item/serial-suggest    → autocomplete de serial
 *
 * El reparto responde a cómo está hecha la página hoy: la tabla pinta ocho
 * columnas pero el cliente se trae las veintinueve de cada fila, y los selects
 * de filtro se llenan con un `groupBy` de ese array. Lo primero se resuelve
 * paginando y proyectando; lo segundo NO se resuelve paginando —el cliente
 * dejaría de ver los valores que no están en la página— y por eso hay un
 * endpoint de agregados en vez de devolver más filas.
 *
 * El scope del rol (locación o categoría) se aplica DENTRO de la consulta, no
 * después. Hoy el cliente lo aplica sobre el array ya recibido
 * (`ItemTable.jsx:258`); con páginas del servidor eso dejaría una página de 50
 * convertida en 7 y un total que no cuadra con lo que se ve.
 */

const getConnection = require('../database/config');
const logger = require('../../helpers/logger');
const { buildInventoryScopeFilter } = require('../helpers/staffAccess');
const { resolveCompanyContext } = require('../helpers/companyContext');
const {
  buildPageQuery,
  toPage,
  buildCountQuery,
  buildFacetQuery,
  buildSerialSuggestQuery,
  FACET_FIELDS,
  QueryParamError,
} = require('../queries/inventoryPageQuery');

/**
 * Resuelve compañía y scope, o envía el error y devuelve null.
 *
 * Se apoya en `resolveCompanyContext`, que es el único sitio donde vive esta
 * decisión en el repo: prefiere el header `s-company-lq` —que el cliente manda
 * ya en toda ruta `/api/db_*`—, cae al body o la query para quien no lo mande,
 * y comprueba con `getStaffCompanyAccess` que quien llama es miembro ACTIVO de
 * esa compañía. El header no autoriza nada por sí mismo: es tan falsificable
 * como un campo del body, y la confianza sale de la comprobación de membresía.
 *
 * Y si llegan los dos y NO coinciden, 400 en vez de elegir uno en silencio.
 * Para un usuario multi-compañía pueden divergir de verdad —el frontend saca el
 * header de localStorage y el body de Redux, con momentos de escritura
 * distintos—, y entonces se comprobarían los permisos contra una compañía y se
 * leería el inventario de otra. La respuesta nombra los dos valores porque si
 * no, esto parece un fallo de permisos y cuesta una tarde de depuración de cada
 * lado. Misma regla y mismo formato que `validateCountBody` en `eventCount.js`.
 */
const resolveAccess = async (
  request,
  response,
  declaredCompanyId,
  { resolveContextFn = resolveCompanyContext } = {}
) => {
  const context = await resolveContextFn(request);
  if (!context.ok) {
    response.status(context.status).json({ ok: false, msg: context.msg });
    return null;
  }

  if (
    declaredCompanyId !== undefined &&
    declaredCompanyId !== null &&
    String(declaredCompanyId) !== String(context.companyId)
  ) {
    response.status(400).json({
      ok: false,
      msg: 'Company mismatch between header and body',
      detail: { header: context.companyId, body: declaredCompanyId },
    });
    return null;
  }

  return {
    companyId: context.companyId,
    access: context.access,
    scope: buildInventoryScopeFilter(context.access),
  };
};

const handleError = (response, error, where) => {
  if (error instanceof QueryParamError) {
    return response.status(400).json({ ok: false, msg: error.message });
  }
  logger.error(`${where}: ${error.message}`);
  return response.status(500).json({ ok: false, msg: error.message });
};

const getInventoryPage = async (request, response) => {
  try {
    const body = request.body || {};
    const resolved = await resolveAccess(request, response, body.company_id);
    if (!resolved) return undefined;

    const query = buildPageQuery({
      companyId: resolved.companyId,
      filters: body.filters,
      search: body.search,
      scope: resolved.scope,
      sortBy: body.sortBy,
      sortDir: body.sortDir,
      cursor: body.cursor,
      pageSize: body.pageSize,
    });

    const connection = getConnection();
    const [rows] = await connection.execute(query.sql, query.params);
    const page = toPage(rows, { pageSize: query.pageSize, sort: query.sort });

    return response.status(200).json({ ok: true, ...page });
  } catch (error) {
    return handleError(response, error, 'getInventoryPage');
  }
};

/**
 * Total de coincidencias y valores disponibles por filtro, sobre el inventario
 * COMPLETO (con los filtros y la búsqueda activos aplicados).
 *
 * Son ocho consultas agregadas en vez de una que devuelve filas. Cuestan lo
 * mismo que el `GROUP BY` que ya hace `company-inventory-structure`, y su
 * respuesta no crece con el inventario: es lo que permite que un cliente con
 * 50.000 ítems pinte sus desplegables sin descargarlos.
 */
const getInventoryFacets = async (request, response) => {
  try {
    const body = request.body || {};
    const resolved = await resolveAccess(request, response, body.company_id);
    if (!resolved) return undefined;

    const shared = {
      companyId: resolved.companyId,
      filters: body.filters,
      search: body.search,
      scope: resolved.scope,
    };

    const requested = Array.isArray(body.facets) && body.facets.length
      ? body.facets
      : [...FACET_FIELDS];

    const connection = getConnection();
    const count = buildCountQuery(shared);
    const [countRows] = await connection.execute(count.sql, count.params);

    const facets = {};
    for (const field of requested) {
      const query = buildFacetQuery(field, shared);
      const [rows] = await connection.execute(query.sql, query.params);
      facets[field] = rows
        .filter((row) => row.value !== null && row.value !== '')
        .map((row) => ({ value: row.value, count: Number(row.count) }));
    }

    return response.status(200).json({
      ok: true,
      matchedTotal: Number(countRows[0] ? countRows[0].total : 0),
      facets,
    });
  } catch (error) {
    return handleError(response, error, 'getInventoryFacets');
  }
};

/**
 * Autocomplete del select de serial, que hoy se llena con una opción por ítem
 * —50.000 opciones en un desplegable para una compañía grande—.
 */
const suggestSerials = async (request, response) => {
  try {
    const companyId = request.query.company_id;
    const resolved = await resolveAccess(request, response, companyId);
    if (!resolved) return undefined;

    const query = buildSerialSuggestQuery({
      companyId: resolved.companyId,
      term: request.query.q,
      scope: resolved.scope,
      limit: request.query.limit,
    });

    const connection = getConnection();
    const [rows] = await connection.execute(query.sql, query.params);

    return response.status(200).json({ ok: true, items: rows });
  } catch (error) {
    return handleError(response, error, 'suggestSerials');
  }
};

module.exports = { getInventoryPage, getInventoryFacets, suggestSerials, resolveAccess };
