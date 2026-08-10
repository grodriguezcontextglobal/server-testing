'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  catalog,
  buildNamedQuery,
  listQueryNames,
  QueryParamError,
} = require('../mysql/queries/inventoryQueryCatalog');

const CTX = { companyId: 133 };

// ─── Invariantes que aplican a TODAS las entradas ────────────────────────────
// Estas son las propiedades por las que existe el catálogo. Si alguien agrega
// una entrada que las rompe, falla acá y no en producción.

test('ninguna entrada mete valores en el texto SQL: los IN generan placeholders', () => {
  // Valores deliberadamente distintivos: uno de una sola letra daria un falso
  // positivo al aparecer como substring dentro de identificadores como
  // `item_group`.
  const G = 'ZZGRUPOZZ';
  const C = 'ZZCATEGORIAZZ';
  const L = 'ZZUBICACIONZZ';

  const cases = {
    'inventory.itemsByIds': { itemIds: [901, 902, 903] },
    'inventory.itemsByGroupCategoryLocationSerials': {
      itemGroup: G, categoryName: C, location: L, serialNumbers: ['ZZSN1', 'ZZSN2'],
    },
    'inventory.itemIdsByGroupCategorySerials': {
      itemGroup: G, categoryName: C, serialNumbers: ['ZZSN1', 'ZZSN2'],
    },
    'inventory.itemsSummaryByIds': { itemIds: [907, 908] },
    'inventory.markInWarehouse': {
      itemGroup: G, categoryName: C, serialNumbers: ['ZZSN1', 'ZZSN2'],
    },
    'eventAssignments.deleteByEventAndItems': { eventId: 905, itemIds: [909, 910] },
    'staff.idsByEmails': { emails: ['zz-a@b.com', 'zz-c@d.com'] },
    'staff.detailsByIds': { staffIds: [901, 902] },
  };

  for (const [name, params] of Object.entries(cases)) {
    const { sql, values } = buildNamedQuery(name, params, CTX);
    for (const value of Object.values(params).flat()) {
      assert.ok(
        !sql.includes(String(value)),
        `${name}: el valor ${value} no debe aparecer en el SQL`,
      );
    }
    assert.ok(values.length > 0, `${name}: debe pasar valores parametrizados`);
  }
});

test('la cantidad de ? en el SQL coincide con la cantidad de valores', () => {
  const cases = [
    ['inventory.itemsByIds', { itemIds: [1, 2, 3] }],
    ['inventory.itemsByIds', { itemIds: [1], supplierId: 'SUP' }],
    ['inventory.serialsByGroupCategoryLocation', { itemGroup: 'g', categoryName: 'c', location: 'l' }],
    ['inventory.itemsByGroupCategoryLocationSerials', { itemGroup: 'g', categoryName: 'c', location: 'l', serialNumbers: ['A', 'B', 'C'] }],
    ['inventory.itemIdsByGroupCategorySerials', { itemGroup: 'g', categoryName: 'c', serialNumbers: ['A'] }],
    ['inventory.itemsSummaryByIds', { itemIds: [1, 2] }],
    ['inventory.assignableExactSerial', { location: 'l', itemGroup: 'g', categoryName: 'c', serialNumber: 'S' }],
    ['inventory.assignableFromSerial', { location: 'l', itemGroup: 'g', categoryName: 'c', startingSerial: 'S', quantity: 10 }],
    ['inventory.byAttribute', { attribute: 'brand', value: 'Apple' }],
    ['inventory.rentedPage', { pageSize: 10, offset: 0 }],
    ['inventory.rentedPage', { pageSize: 10, offset: 0, supplierId: 'X', search: 'abc' }],
    ['inventory.rentedCount', { supplierId: 'X', search: 'abc' }],
    ['inventory.rentedAll', {}],
    ['inventory.markInWarehouse', { itemGroup: 'g', categoryName: 'c', serialNumbers: ['A', 'B'] }],
    ['eventAssignments.deleteByEventAndItems', { eventId: 1, itemIds: [2, 3] }],
    ['staff.idsByEmails', { emails: ['a@b.com'] }],
    ['staff.detailsByIds', { staffIds: [1, 2, 3] }],
  ];

  for (const [name, params] of cases) {
    const { sql, values } = buildNamedQuery(name, params, CTX);
    const placeholderCount = (sql.match(/\?/g) || []).length;
    assert.equal(
      placeholderCount,
      values.length,
      `${name}: ${placeholderCount} placeholders vs ${values.length} valores`,
    );
  }
});

test('toda entrada acota por la compañía del contexto, no por una del cliente', () => {
  for (const name of listQueryNames()) {
    const params = {
      itemIds: [1], serialNumbers: ['A'], staffIds: [1], emails: ['a@b.com'],
      itemGroup: 'g', categoryName: 'c', location: 'l', serialNumber: 'S',
      startingSerial: 'S', quantity: 5, eventId: 1, attribute: 'brand',
      value: 'v', pageSize: 10, offset: 0,
    };
    const { sql, values } = buildNamedQuery(name, params, CTX);
    assert.ok(
      /company_id\s*=\s*\?/.test(sql),
      `${name}: debe filtrar por company_id`,
    );
    assert.ok(
      values.includes(CTX.companyId),
      `${name}: el company_id del contexto debe estar entre los valores`,
    );
  }
});

// Este es EL test de la vulnerabilidad original: el cliente mandaba el
// company_id dentro del SQL y el servidor lo ejecutaba tal cual.
test('un company_id enviado como parámetro por el cliente es ignorado', () => {
  const { values } = buildNamedQuery(
    'inventory.itemsByIds',
    { itemIds: [1], companyId: 999, company_id: 999 },
    { companyId: 133 },
  );
  assert.ok(values.includes(133), 'debe usar el company_id verificado del contexto');
  assert.ok(!values.includes(999), 'no debe usar el company_id que mandó el cliente');
});

test('sin contexto de compañía no se construye ninguna query', () => {
  assert.throws(
    () => buildNamedQuery('inventory.rentedAll', {}, {}),
    QueryParamError,
  );
});

// ─── Scoping agregado a las formas que no lo tenían ──────────────────────────

test('las entradas marcadas scopingAdded corresponden a las formas cross-tenant del endpoint viejo', () => {
  const conScopingAgregado = Object.entries(catalog)
    .filter(([, entry]) => entry.scopingAdded)
    .map(([name]) => name)
    .sort();

  assert.deepEqual(conScopingAgregado, [
    'eventAssignments.deleteByEventAndItems',
    'inventory.itemIdsByGroupCategorySerials',
    'inventory.itemsSummaryByIds',
    'staff.detailsByIds',
    'staff.idsByEmails',
  ]);
});

test('el DELETE de asignaciones se acota por join a item_inv (la tabla no tiene company_id)', () => {
  const { sql } = buildNamedQuery(
    'eventAssignments.deleteByEventAndItems',
    { eventId: 1, itemIds: [2, 3] },
    CTX,
  );
  assert.match(sql, /JOIN item_inv ii ON ii\.item_id = iiae\.item_id/);
  assert.match(sql, /ii\.company_id = \?/);
});

test('las queries de staff se acotan por company_staff activo (staff_member no tiene company_id)', () => {
  for (const name of ['staff.idsByEmails', 'staff.detailsByIds']) {
    const params = name === 'staff.idsByEmails' ? { emails: ['a@b.com'] } : { staffIds: [1] };
    const { sql } = buildNamedQuery(name, params, CTX);
    assert.match(sql, /JOIN company_staff cs ON cs\.staff_id = sm\.staff_id/);
    assert.match(sql, /cs\.company_id = \? AND cs\.is_active = 1/);
  }
});

// ─── Validación de parámetros ────────────────────────────────────────────────

test('el nombre de atributo se valida contra una allowlist (va concatenado al SQL)', () => {
  assert.doesNotThrow(() =>
    buildNamedQuery('inventory.byAttribute', { attribute: 'brand', value: 'x' }, CTX),
  );
  for (const malicioso of ['brand = 1 OR 1=1 --', 'password', 'item_id; DROP TABLE item_inv']) {
    assert.throws(
      () => buildNamedQuery('inventory.byAttribute', { attribute: malicioso, value: 'x' }, CTX),
      QueryParamError,
      `debe rechazar el atributo ${malicioso}`,
    );
  }
});

test('LIMIT/OFFSET solo aceptan enteros (van interpolados, no como placeholder)', () => {
  for (const malicioso of ['10; DROP TABLE item_inv', '1 OR 1=1', -5, 1.5, 'abc']) {
    assert.throws(
      () => buildNamedQuery('inventory.rentedPage', { pageSize: malicioso, offset: 0 }, CTX),
      QueryParamError,
    );
  }
  const { sql } = buildNamedQuery('inventory.rentedPage', { pageSize: 25, offset: 50 }, CTX);
  assert.match(sql, /LIMIT 25 OFFSET 50/);
});

test('las listas vacías o ausentes se rechazan con 400, no generan SQL invalido', () => {
  for (const valor of [undefined, null, [], 'no-es-array']) {
    assert.throws(
      () => buildNamedQuery('inventory.itemsByIds', { itemIds: valor }, CTX),
      QueryParamError,
    );
  }
});

test('un queryName desconocido se rechaza', () => {
  assert.throws(() => buildNamedQuery('no.existe', {}, CTX), QueryParamError);
});

// ─── Equivalencia con las queries legacy ─────────────────────────────────────

test('inventory.itemsByIds reproduce la forma legacy, con y sin supplier', () => {
  const sinSupplier = buildNamedQuery('inventory.itemsByIds', { itemIds: [1, 2] }, CTX);
  assert.match(
    sinSupplier.sql,
    /SELECT item_id, serial_number, item_group FROM item_inv WHERE item_id IN \(\?, \?\) AND ownership = \? AND company_id = \?/,
  );
  assert.deepEqual(sinSupplier.values, [1, 2, 'Rent', 133]);

  const conSupplier = buildNamedQuery('inventory.itemsByIds', { itemIds: [1], supplierId: 'SUP9' }, CTX);
  assert.match(conSupplier.sql, /AND supplier_info = \?$/);
  assert.deepEqual(conSupplier.values, [1, 'Rent', 133, 'SUP9']);
});

test('inventory.rentedPage y rentedCount comparten exactamente el mismo filtro', () => {
  const params = { supplierId: 'SUP', search: 'abc' };
  const page = buildNamedQuery('inventory.rentedPage', { ...params, pageSize: 10, offset: 0 }, CTX);
  const count = buildNamedQuery('inventory.rentedCount', params, CTX);

  // Si los filtros divergen, el total paginado deja de corresponder a la lista.
  const whereDePage = page.sql.split(' WHERE ')[1].split(' LIMIT ')[0];
  const whereDeCount = count.sql.split(' WHERE ')[1];
  assert.equal(whereDePage, whereDeCount);
  assert.deepEqual(page.values, count.values);
});
