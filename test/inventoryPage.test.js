'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LIST_COLUMNS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildBaseFilter,
  buildPageQuery,
  toPage,
  buildCountQuery,
  buildFacetQuery,
  buildSerialSuggestQuery,
  QueryParamError,
} = require('../mysql/queries/inventoryPageQuery');

const COMPANY = 62;
const noScope = { sql: '', params: [] };

/* ---------------------------------------------------------------- *
 * Proyección: la razón de ser del endpoint
 * ---------------------------------------------------------------- */

test('la página proyecta columnas, nunca SELECT *', () => {
  const { sql } = buildPageQuery({ companyId: COMPANY, scope: noScope });
  assert.ok(!/SELECT\s+\*/i.test(sql), 'un SELECT * aquí devuelve las 29 columnas de item_inv');
  assert.equal(LIST_COLUMNS.length, 13);
  for (const column of LIST_COLUMNS) assert.ok(sql.includes(`\`${column}\``), `falta ${column}`);
});

test('las cuatro columnas pesadas se quedan fuera de la lista', () => {
  // Son las que no comprime gzip y las que solo hacen falta al abrir la ficha,
  // que ya sirve POST /api/db_item/consulting-item.
  const { sql } = buildPageQuery({ companyId: COMPANY, scope: noScope });
  for (const pesada of ['descript_item', 'extra_serial_number', 'returnedRentedInfo', 'supplier_info']) {
    assert.ok(!sql.includes(pesada), `${pesada} no debe viajar en cada fila de la tabla`);
  }
});

/* ---------------------------------------------------------------- *
 * Tamaño de página y "hay más"
 * ---------------------------------------------------------------- */

test('pageSize: por defecto 50, y con techo duro', () => {
  assert.ok(buildPageQuery({ companyId: COMPANY, scope: noScope }).sql.endsWith(`LIMIT ${DEFAULT_PAGE_SIZE + 1}`));
  const enorme = buildPageQuery({ companyId: COMPANY, scope: noScope, pageSize: 50000 });
  assert.equal(enorme.pageSize, MAX_PAGE_SIZE, 'nadie puede pedir el inventario entero por la puerta de atrás');
});

test('pageSize invalido se rechaza con 400, no se ignora en silencio', () => {
  assert.throws(() => buildPageQuery({ companyId: COMPANY, scope: noScope, pageSize: -5 }), QueryParamError);
});

test('pide una fila de más para saber si hay siguiente página', () => {
  const query = buildPageQuery({ companyId: COMPANY, scope: noScope, pageSize: 2 });
  assert.ok(query.sql.endsWith('LIMIT 3'));

  const rows = [{ item_id: 1 }, { item_id: 2 }, { item_id: 3 }];
  const page = toPage(rows, { pageSize: 2, sort: { sortBy: null, sortDir: 'asc' } });
  assert.equal(page.items.length, 2, 'la fila sonda no se devuelve');
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.nextCursor, { id: 2 });
});

test('en la última página nextCursor es null (el defecto de la ruta vieja)', () => {
  // consultingCompanyInventoryWithPagination devuelve el item_id de la última
  // fila SIEMPRE, así que el cliente no sabe parar y hace una llamada de más
  // que vuelve vacía.
  const page = toPage([{ item_id: 1 }, { item_id: 2 }], { pageSize: 10, sort: { sortBy: null, sortDir: 'asc' } });
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
});

/* ---------------------------------------------------------------- *
 * Nombres de columna: lo único que no puede ser parámetro
 * ---------------------------------------------------------------- */

test('un filtro fuera de la allowlist se rechaza', () => {
  // El valor va parametrizado, pero el NOMBRE entra en el texto del SQL. Es la
  // grieta que hoy tiene consultingCompanyInventoryWithPagination (item.js:1931),
  // que concatena Object.keys(request.body) sin comprobar nada.
  assert.throws(
    () => buildPageQuery({ companyId: COMPANY, scope: noScope, filters: { 'item_id = 1 OR 1': 1 } }),
    QueryParamError
  );
});

test('un sortBy fuera de la allowlist se rechaza', () => {
  assert.throws(
    () => buildPageQuery({ companyId: COMPANY, scope: noScope, sortBy: 'descript_item' }),
    QueryParamError
  );
});

test('los valores de los filtros van como parámetros, no en el texto', () => {
  const { sql, params } = buildPageQuery({
    companyId: COMPANY,
    scope: noScope,
    filters: { brand: "Dell'; DROP TABLE item_inv; --" },
  });
  assert.ok(!sql.includes('DROP TABLE'));
  assert.ok(params.includes("Dell'; DROP TABLE item_inv; --"));
});

/* ---------------------------------------------------------------- *
 * Keyset
 * ---------------------------------------------------------------- */

test('sin orden explícito, el cursor es solo item_id', () => {
  const { sql, params } = buildPageQuery({ companyId: COMPANY, scope: noScope, cursor: { id: 200336 } });
  assert.ok(sql.includes('item_id > ?'));
  assert.ok(sql.includes('ORDER BY item_id ASC'));
  assert.deepEqual(params, [COMPANY, 200336]);
});

test('ordenando por otra columna, el cursor lleva dos valores y desempata por item_id', () => {
  // Miles de filas comparten categoría: sin el desempate, la página siguiente
  // repetiría o se saltaría filas.
  const { sql, params } = buildPageQuery({
    companyId: COMPANY,
    scope: noScope,
    sortBy: 'category_name',
    cursor: { v: 'Laptop', id: 200336 },
  });
  assert.match(sql, /COALESCE\(`category_name`, ''\) > \? OR \(COALESCE\(`category_name`, ''\) = \? AND item_id > \?\)/);
  assert.match(sql, /ORDER BY COALESCE\(`category_name`, ''\) ASC, item_id ASC/);
  assert.deepEqual(params, [COMPANY, 'Laptop', 'Laptop', 200336]);
});

test('en orden descendente el keyset compara al revés', () => {
  const { sql } = buildPageQuery({
    companyId: COMPANY,
    scope: noScope,
    sortBy: 'ownership',
    sortDir: 'desc',
    cursor: { v: 'Rent', id: 10 },
  });
  assert.ok(sql.includes("COALESCE(`ownership`, '') < ?"));
  assert.ok(sql.includes('ORDER BY COALESCE(`ownership`, \'\') DESC, item_id DESC'));
});

test('un cursor a medias se rechaza en vez de devolver una página equivocada', () => {
  assert.throws(
    () => buildPageQuery({ companyId: COMPANY, scope: noScope, sortBy: 'ownership', cursor: { id: 10 } }),
    QueryParamError
  );
});

test('el NULL de la columna de orden no corta la paginación', () => {
  // `col > NULL` es NULL, nunca cierto: sin COALESCE, la página siguiente
  // vendría vacía aunque queden filas por servir.
  const { sql, params } = buildPageQuery({
    companyId: COMPANY,
    scope: noScope,
    sortBy: 'location',
    cursor: { v: null, id: 5 },
  });
  assert.ok(sql.includes("COALESCE(`location`, '')"));
  assert.deepEqual(params, [COMPANY, '', '', 5]);
});

/* ---------------------------------------------------------------- *
 * Búsqueda
 * ---------------------------------------------------------------- */

test('el serial se busca por prefijo y el resto por substring', () => {
  const { sql, params } = buildBaseFilter({ companyId: COMPANY, search: '00100', scope: noScope });
  assert.ok(sql.includes('`serial_number` LIKE ?'));
  assert.ok(params.includes('00100%'), 'prefijo: es lo único que puede usar un índice');
  assert.ok(params.includes('%00100%'), 'substring para grupo/categoría/marca');
});

test('los comodines de LIKE se escapan', () => {
  // Sin esto, buscar "100%" devuelve la tabla entera.
  const { params } = buildBaseFilter({ companyId: COMPANY, search: '100%', scope: noScope });
  assert.ok(params.includes('100\\%%'));
});

test('un término demasiado corto se ignora en vez de escanear la tabla', () => {
  const { sql } = buildBaseFilter({ companyId: COMPANY, search: 'a', scope: noScope });
  assert.ok(!sql.includes('LIKE'));
});

/* ---------------------------------------------------------------- *
 * Scope del rol: dentro de la consulta, no después
 * ---------------------------------------------------------------- */

test('el scope entra en el WHERE, antes de contar y de cortar', () => {
  const scope = { sql: 'location_id IN (?,?)', params: [7, 9] };
  const page = buildPageQuery({ companyId: COMPANY, scope, pageSize: 10 });
  const count = buildCountQuery({ companyId: COMPANY, scope });

  assert.ok(page.sql.includes('location_id IN (?,?)'));
  assert.ok(count.sql.includes('location_id IN (?,?)'), 'si el total ignora el scope, miente');
  assert.deepEqual(count.params, [COMPANY, 7, 9]);
});

test('un rol scoped sin asignaciones no ve nada (fail-closed)', () => {
  const { sql } = buildPageQuery({ companyId: COMPANY, scope: { sql: '1=0', params: [] } });
  assert.ok(sql.includes('1=0'));
});

test('company_id sale siempre del contexto verificado', () => {
  assert.throws(() => buildBaseFilter({ filters: {}, scope: noScope }), QueryParamError);
  const { params } = buildBaseFilter({ companyId: COMPANY, scope: noScope });
  assert.equal(params[0], COMPANY, 'el primer parámetro es la compañía, siempre');
});

/* ---------------------------------------------------------------- *
 * Facetas
 * ---------------------------------------------------------------- */

test('una faceta no se filtra por sí misma', () => {
  // Con brand=Dell elegido, el desplegable de marcas tiene que seguir
  // enseñando las demás o no hay forma de cambiar de marca.
  const { sql, params } = buildFacetQuery('brand', {
    companyId: COMPANY,
    filters: { brand: 'Dell', location: 'Warehouse A' },
    scope: noScope,
  });
  assert.ok(sql.includes('GROUP BY `brand`'));
  assert.ok(params.includes('Warehouse A'), 'los otros filtros sí se aplican');
  assert.ok(!params.includes('Dell'), 'el propio campo no se filtra');
});

test('una faceta desconocida se rechaza', () => {
  assert.throws(() => buildFacetQuery('descript_item', { companyId: COMPANY, scope: noScope }), QueryParamError);
});

test('el total respeta los mismos filtros y búsqueda que la página', () => {
  const shared = { companyId: COMPANY, filters: { brand: 'Dell' }, search: '00100', scope: noScope };
  const count = buildCountQuery(shared);
  const page = buildPageQuery(shared);
  assert.ok(count.sql.startsWith('SELECT COUNT(*) AS total'));
  assert.deepEqual(count.params, page.params, 'si divergen, el contador no cuadra con lo que se ve');
});

/* ---------------------------------------------------------------- *
 * Autocomplete de serial
 * ---------------------------------------------------------------- */

test('serial-suggest busca por prefijo y con tope', () => {
  const { sql, params } = buildSerialSuggestQuery({ companyId: COMPANY, term: '001', scope: noScope, limit: 999 });
  assert.ok(params.includes('001%'));
  assert.ok(!params.some((p) => String(p).startsWith('%')), 'un substring aquí recorre la tabla en cada pulsación');
  assert.ok(sql.includes('LIMIT 20'), 'el tope no lo elige el cliente');
});

test('serial-suggest exige un término mínimo', () => {
  assert.throws(() => buildSerialSuggestQuery({ companyId: COMPANY, term: 'a', scope: noScope }), QueryParamError);
});

/* ---------------------------------------------------------------- *
 * Contexto de compañía: header vs body
 * ---------------------------------------------------------------- */

const { resolveAccess } = require('../mysql/controllers/inventoryPage');

const makeResponse = () => {
  const sent = {};
  return {
    sent,
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
  };
};

const contextOk = (companyId) => async () => ({
  ok: true,
  companyId,
  access: { scoped: false, role_level: 0, locations: [], categoryNames: [] },
});

test('el header s-company-lq manda, y el body no hace falta', async () => {
  // El cliente lo envía automáticamente en toda ruta /api/db_*, así que llega
  // aunque el contrato no lo pida.
  const response = makeResponse();
  const resolved = await resolveAccess({}, response, undefined, { resolveContextFn: contextOk('62') });
  assert.equal(resolved.companyId, '62');
  assert.equal(response.sent.status, undefined, 'no debe responder nada');
});

test('header y body que NO coinciden dan 400 nombrando los dos', async () => {
  // Para un usuario multi-compañía divergen de verdad: el header sale de
  // localStorage y el body de Redux. Elegir uno en silencio sería comprobar
  // permisos contra una compañía y leer el inventario de otra.
  const response = makeResponse();
  const resolved = await resolveAccess({}, response, '77', { resolveContextFn: contextOk('62') });

  assert.equal(resolved, null);
  assert.equal(response.sent.status, 400);
  assert.equal(response.sent.body.msg, 'Company mismatch between header and body');
  assert.deepEqual(response.sent.body.detail, { header: '62', body: '77' });
});

test('mismo valor en los dos sitios pasa, aunque uno sea número y otro texto', async () => {
  const response = makeResponse();
  const resolved = await resolveAccess({}, response, 62, { resolveContextFn: contextOk('62') });
  assert.equal(resolved.companyId, '62');
  assert.equal(response.sent.status, undefined);
});

test('sin contexto de compañía se devuelve el error del resolutor, no un 500', async () => {
  const response = makeResponse();
  const resolved = await resolveAccess({}, response, undefined, {
    resolveContextFn: async () => ({ ok: false, status: 403, msg: 'Not an active staff member of this company.' }),
  });
  assert.equal(resolved, null);
  assert.equal(response.sent.status, 403);
});

test('la columna Status se puede ordenar por lo que pinta', () => {
  // "Status" ordena hoy por `warehouse` y muestra `logistic_status`.
  const { sql } = buildPageQuery({ companyId: COMPANY, scope: noScope, sortBy: 'logistic_status' });
  assert.ok(sql.includes("ORDER BY COALESCE(`logistic_status`, '') ASC, item_id ASC"));
});
