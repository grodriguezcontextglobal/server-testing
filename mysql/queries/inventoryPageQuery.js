'use strict';

/**
 * Consultas de la página de inventario: una página de la tabla y el resumen
 * (total + facetas) del inventario completo.
 *
 * POR QUÉ EXISTE: hoy `/inventory` descarga el inventario ENTERO de la compañía
 * —tres veces, según el manifiesto del frontend— y filtra, busca, ordena y
 * pagina en memoria del navegador. Con inventarios grandes eso rompe en el
 * cliente, y en el servidor deja un `SELECT *` de 29 columnas sin LIMIT
 * (`mysql/controllers/item.js:656`) cuyo `JSON.stringify` bloquea el event loop
 * del worker que lo atiende.
 *
 * El reparto es: la TABLA pide páginas (esta consulta), y lo que necesita
 * conocer el conjunto completo —cuántos hay y qué valores existen para cada
 * filtro— se responde con AGREGADOS, no con filas.
 *
 * Este módulo es puro a propósito: construye SQL y parámetros, no toca la
 * conexión. Así se puede probar la forma de cada consulta sin base de datos,
 * que es como está probado el catálogo de `inventoryQueryCatalog.js`.
 */

const { QueryParamError } = require('./inventoryQueryCatalog');

/**
 * Columnas que la tabla pinta de verdad, según `ColumnsFormat.jsx`: ocho
 * columnas más cinco campos que se consumen sin ser columna (avatar, píldora de
 * estado, filtros y botones de acción).
 *
 * Fuera quedan `sub_location` y `container` —que no se pintan— y las cuatro
 * pesadas (`descript_item`, `extra_serial_number`, `returnedRentedInfo`,
 * `supplier_info`), que ya sirve `POST /api/db_item/consulting-item` cuando se
 * abre la ficha del ítem. Son justo las que no comprime bien gzip.
 */
const LIST_COLUMNS = [
  'item_id',
  'serial_number',
  'category_name',
  'item_group',
  'brand',
  'ownership',
  'location',
  'main_warehouse',
  'warehouse',
  'logistic_status',
  'status',
  'image_url',
  'enableAssignFeature',
];

/**
 * Columnas por las que se puede filtrar. Allowlist, no lista negra: el nombre
 * de una columna es lo único que no puede ir como parámetro —entra en el texto
 * del SQL— así que jamás puede venir del cliente sin comprobar. Es el mismo
 * motivo por el que existe `FILTERABLE_ATTRIBUTES` en el catálogo, y lo que le
 * falta a `consultingCompanyInventoryWithPagination` (`item.js:1931`).
 *
 * No están los dos filtros que el frontend pinta hoy y que NO tienen columna:
 * "Staff member" (se deriva de `usage`, que `retrieveCompanyInventory` calcula
 * desde `item_inv_assigned_event`, no es un campo de `item_inv`) y "Condition"
 * (`condition` vive en `item_inv_assigned_event`). Ver el informe.
 */
const FILTERABLE = new Set([
  'brand',
  'item_group',
  'category_name',
  'location',
  'ownership',
  'warehouse',
  'logistic_status',
  'status',
  'main_warehouse',
]);

/**
 * Columnas ordenables. Son las siete que antd declara con `sorter`, menos la
 * que hoy está rota: `serial_number` se ordena como TEXTO. El comparador del
 * cliente hace `a - b` sobre cadenas con contador al final, que da `NaN`.
 */
const SORTABLE = new Set([
  'category_name',
  'item_group',
  'warehouse',
  'ownership',
  'main_warehouse',
  'location',
  'serial_number',
  // `logistic_status` no es una de las siete que antd declara ordenables, pero
  // sí es lo que PINTA la columna "Status": esa columna ordena por `warehouse`
  // y muestra `logistic_status`, así que ordenarla no ordena por lo que se ve.
  // Se ofrece la columna correcta para que el frontend pueda cerrar el desfase.
  'logistic_status',
]);

/** Campos de los que se calculan facetas (los ocho selects, menos el serial). */
const FACET_FIELDS = new Set([
  'brand',
  'item_group',
  'category_name',
  'location',
  'ownership',
  'logistic_status',
  'status',
]);

/**
 * Dónde busca el texto libre.
 *
 * CAMBIO DE COMPORTAMIENTO CONSCIENTE: hoy el cliente hace
 * `JSON.stringify(fila).includes(término)`, así que encuentra coincidencias en
 * campos que la tabla ni siquiera pinta y dentro del objeto crudo anidado. Eso
 * no se puede reproducir en SQL sin escanear cada columna de cada fila. Se fija
 * un conjunto explícito, y el serial —el caso del escáner de código de barras—
 * va por PREFIJO, que es lo único que puede usar un índice.
 */
const SEARCH_PREFIX_COLUMNS = ['serial_number'];
const SEARCH_SUBSTRING_COLUMNS = ['item_group', 'category_name', 'brand'];

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const MIN_SEARCH_LENGTH = 2;
const MAX_FACET_VALUES = 200;
const MAX_SUGGESTIONS = 20;

/**
 * `%` y `_` son comodines de LIKE: sin escaparlos, buscar "100%" devuelve toda
 * la tabla. Misma regla que `escapeLike` en `controller/search.js:23`.
 */
const escapeLike = (value) => String(value ?? '').replace(/[\\%_]/g, (char) => `\\${char}`);

const clampPageSize = (value) => {
  if (value === undefined || value === null || value === '') return DEFAULT_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new QueryParamError('pageSize must be a positive integer');
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
};

const normalizeSearch = (value) => {
  const term = String(value ?? '').trim();
  if (!term) return null;
  // Por debajo del mínimo se ignora en vez de rechazar: el usuario está
  // escribiendo, y un 400 a media palabra no ayuda a nadie.
  if (term.length < MIN_SEARCH_LENGTH) return null;
  return term;
};

const requireCompanyId = (companyId) => {
  if (companyId === undefined || companyId === null || companyId === '') {
    throw new QueryParamError('company context could not be resolved');
  }
  return companyId;
};

/**
 * WHERE común a las tres consultas: compañía + scope del rol + filtros +
 * búsqueda. El `companyId` llega SIEMPRE del contexto verificado del llamante,
 * nunca del body — misma invariante que el catálogo.
 *
 * `scope` es lo que devuelve `buildInventoryScopeFilter()`: se aplica aquí,
 * antes de contar y antes de cortar por cursor. Hacerlo después (como hace hoy
 * el cliente en `ItemTable.jsx:258`) dejaría páginas de 10 filas convertidas en
 * 3 y un total que miente.
 */
const buildBaseFilter = ({ companyId, filters = {}, search, scope = { sql: '', params: [] } }) => {
  const clauses = ['company_id = ?'];
  const params = [requireCompanyId(companyId)];

  for (const [column, value] of Object.entries(filters || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (!FILTERABLE.has(column)) {
      throw new QueryParamError(
        `filter must be one of: ${[...FILTERABLE].sort().join(', ')}`
      );
    }
    clauses.push(`\`${column}\` = ?`);
    params.push(value);
  }

  const term = normalizeSearch(search);
  if (term) {
    const needle = escapeLike(term);
    const parts = [
      ...SEARCH_PREFIX_COLUMNS.map((column) => `\`${column}\` LIKE ? ESCAPE '\\\\'`),
      ...SEARCH_SUBSTRING_COLUMNS.map((column) => `\`${column}\` LIKE ? ESCAPE '\\\\'`),
    ];
    clauses.push(`(${parts.join(' OR ')})`);
    SEARCH_PREFIX_COLUMNS.forEach(() => params.push(`${needle}%`));
    SEARCH_SUBSTRING_COLUMNS.forEach(() => params.push(`%${needle}%`));
  }

  if (scope && scope.sql) {
    clauses.push(scope.sql);
    params.push(...(scope.params || []));
  }

  return { sql: clauses.join(' AND '), params };
};

/**
 * Predicado de keyset.
 *
 * Con orden por una columna secundaria hace falta un desempate estable, porque
 * hay miles de filas que comparten marca o categoría: se ordena por
 * `(columna, item_id)` y el cursor lleva los dos valores. Con LIMIT/OFFSET, en
 * cambio, si alguien inserta un ítem mientras se pagina, la página siguiente
 * se salta filas — y aquí insertar inventario mientras alguien lo consulta es
 * el caso normal, no el raro.
 *
 * NULL: se compara y se ordena por `COALESCE(col, '')`. Un NULL en medio de un
 * keyset rompe la comparación (cualquier `col > NULL` es NULL, nunca cierto) y
 * la página siguiente vendría vacía con filas aún por servir.
 */
const buildKeysetPredicate = ({ sortBy, sortDir, cursor }) => {
  if (!cursor) return { sql: '', params: [] };
  const comparator = sortDir === 'desc' ? '<' : '>';

  if (!sortBy) {
    if (cursor.id === undefined || cursor.id === null) {
      throw new QueryParamError('cursor.id is required');
    }
    return { sql: `item_id ${comparator} ?`, params: [cursor.id] };
  }

  if (cursor.id === undefined || cursor.id === null || cursor.v === undefined) {
    throw new QueryParamError('cursor must carry both v and id');
  }
  const col = `COALESCE(\`${sortBy}\`, '')`;
  return {
    sql: `(${col} ${comparator} ? OR (${col} = ? AND item_id ${comparator} ?))`,
    params: [cursor.v ?? '', cursor.v ?? '', cursor.id],
  };
};

const normalizeSort = ({ sortBy, sortDir }) => {
  const dir = String(sortDir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  if (!sortBy) return { sortBy: null, sortDir: dir };
  if (!SORTABLE.has(sortBy)) {
    throw new QueryParamError(`sortBy must be one of: ${[...SORTABLE].sort().join(', ')}`);
  }
  return { sortBy, sortDir: dir };
};

/**
 * Una página de la tabla.
 *
 * Pide `pageSize + 1` filas: la de más no se devuelve, solo dice si hay
 * siguiente. Es el mismo truco que ya usa `searchingInventory`
 * (`controller/search.js:398`), y evita que el cliente tenga que hacer una
 * llamada extra para descubrir que no hay más — que es el defecto de
 * `consultingCompanyInventoryWithPagination`, cuyo `nextCursor` sale no-nulo
 * también en la última página.
 */
const buildPageQuery = ({ companyId, filters, search, scope, sortBy, sortDir, cursor, pageSize }) => {
  const sort = normalizeSort({ sortBy, sortDir });
  const limit = clampPageSize(pageSize);
  const base = buildBaseFilter({ companyId, filters, search, scope });
  const keyset = buildKeysetPredicate({ ...sort, cursor });

  const where = keyset.sql ? `${base.sql} AND ${keyset.sql}` : base.sql;
  const direction = sort.sortDir === 'desc' ? 'DESC' : 'ASC';
  const orderBy = sort.sortBy
    ? `COALESCE(\`${sort.sortBy}\`, '') ${direction}, item_id ${direction}`
    : `item_id ${direction}`;

  return {
    sql:
      `SELECT ${LIST_COLUMNS.map((column) => `\`${column}\``).join(', ')} ` +
      `FROM item_inv WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit + 1}`,
    params: [...base.params, ...keyset.params],
    pageSize: limit,
    sort,
  };
};

/**
 * Convierte las filas crudas en la respuesta de la página: recorta la fila
 * sonda y arma el cursor de la última fila servida.
 */
const toPage = (rows, { pageSize, sort }) => {
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const last = items[items.length - 1];

  let nextCursor = null;
  if (hasMore && last) {
    nextCursor = sort.sortBy
      ? { v: last[sort.sortBy] ?? '', id: last.item_id }
      : { id: last.item_id };
  }

  return { items, pageSize, hasMore, nextCursor };
};

/** Total de filas que casan con los MISMOS filtros que la página. */
const buildCountQuery = ({ companyId, filters, search, scope }) => {
  const base = buildBaseFilter({ companyId, filters, search, scope });
  return {
    sql: `SELECT COUNT(*) AS total FROM item_inv WHERE ${base.sql}`,
    params: base.params,
  };
};

/**
 * Valores distintos de un campo, con su conteo. Es lo que llena los selects de
 * filtro sin descargar el inventario: unos pocos KB tenga la compañía 500
 * ítems o 500.000.
 *
 * `serial_number` NO es faceta: con 50.000 ítems serían 50.000 opciones en un
 * desplegable. Ese va por `buildSerialSuggestQuery`.
 */
const buildFacetQuery = (field, { companyId, filters, search, scope }) => {
  if (!FACET_FIELDS.has(field)) {
    throw new QueryParamError(`facet must be one of: ${[...FACET_FIELDS].sort().join(', ')}`);
  }
  // La faceta de un campo NO se filtra por sí misma: si ya elegiste
  // brand=Dell, el desplegable de marcas debe seguir enseñando las demás, o no
  // hay forma de cambiar de marca sin limpiar el filtro.
  const { [field]: _excluded, ...rest } = filters || {};
  const base = buildBaseFilter({ companyId, filters: rest, search, scope });
  return {
    sql:
      `SELECT \`${field}\` AS value, COUNT(*) AS count FROM item_inv ` +
      `WHERE ${base.sql} GROUP BY \`${field}\` ORDER BY count DESC LIMIT ${MAX_FACET_VALUES}`,
    params: base.params,
  };
};

/**
 * Autocomplete de serial. Prefijo, no substring: `LIKE 'abc%'` puede usar un
 * índice, `LIKE '%abc%'` obliga a recorrer la tabla entera en cada pulsación.
 */
const buildSerialSuggestQuery = ({ companyId, term, scope, limit }) => {
  const needle = normalizeSearch(term);
  if (!needle) {
    throw new QueryParamError(`term must have at least ${MIN_SEARCH_LENGTH} characters`);
  }
  const clauses = ['company_id = ?', "`serial_number` LIKE ? ESCAPE '\\\\'"];
  const params = [requireCompanyId(companyId), `${escapeLike(needle)}%`];
  if (scope && scope.sql) {
    clauses.push(scope.sql);
    params.push(...(scope.params || []));
  }
  const cap = Math.min(Number(limit) > 0 ? Number(limit) : MAX_SUGGESTIONS, MAX_SUGGESTIONS);
  return {
    sql:
      `SELECT item_id, serial_number, category_name, item_group FROM item_inv ` +
      `WHERE ${clauses.join(' AND ')} ORDER BY serial_number ASC LIMIT ${cap}`,
    params,
  };
};

module.exports = {
  LIST_COLUMNS,
  FILTERABLE,
  SORTABLE,
  FACET_FIELDS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_SEARCH_LENGTH,
  escapeLike,
  clampPageSize,
  normalizeSort,
  buildBaseFilter,
  buildKeysetPredicate,
  buildPageQuery,
  toPage,
  buildCountQuery,
  buildFacetQuery,
  buildSerialSuggestQuery,
  QueryParamError,
};
