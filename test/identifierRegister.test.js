/**
 * Fase 3 del plan de conteo por identificador (ver DESIGN_rfid_event_count.md § 7).
 *
 * Registro de identificadores escaneables (EPC / código de barras) contra un
 * item. Sin esto no hay nada que contar.
 *
 * Estilo de la casa: sin DB y sin HTTP — se reemplaza el módulo del pool en
 * require.cache con un pool falso y se afirma sobre el SQL y los params que el
 * controlador produce. Modelo: test/subLocationItemIntegration.test.js.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const loggerStub = { warn: () => {}, error: () => {}, info: () => {} };

const resolve = (rel) => path.resolve(__dirname, '..', rel);

function loadController(poolImpl) {
  const loggerPath = resolve('helpers/logger.js');
  const connPath = resolve('mysql/database/config.js');
  const ctrlPath = resolve('mysql/controllers/identifier.js');
  const accessPath = resolve('mysql/helpers/staffAccess.js');
  const contextPath = resolve('mysql/helpers/companyContext.js');

  require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: loggerStub };
  for (const p of [connPath, ctrlPath, accessPath, contextPath]) delete require.cache[p];
  require.cache[connPath] = { id: connPath, filename: connPath, loaded: true, exports: () => poolImpl };

  return require(ctrlPath);
}

function mockRes() {
  const res = {};
  res.status = (code) => { res._code = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

const COMPANY = '45';

/**
 * @param {object} opts
 * @param {number} opts.roleLevel        rol del staff (1 = acceso total).
 * @param {Array}  opts.scopedItems      filas que devuelve el SELECT de items en scope.
 * @param {Array}  opts.existing         filas que devuelve el SELECT de conflicto.
 */
function makePool({ roleLevel = 1, scopedItems = [{ item_id: 100 }], existing = [] } = {}) {
  const calls = { execute: [], tx: [] };

  const answer = (sql, params, sink) => {
    const trimmed = sql.trim();
    sink.push({ sql: trimmed, params });

    if (/FROM company_staff/i.test(trimmed)) {
      return [[{
        company_staff_id: 'cs-test', role_type: 'admin', role_level: roleLevel,
        location_ids: null, category_ids: null,
      }]];
    }
    if (/FROM item_inv/i.test(trimmed)) return [scopedItems];
    if (/FROM item_identifier/i.test(trimmed)) return [existing];
    if (/^INSERT INTO item_identifier/i.test(trimmed)) return [{ insertId: 7, affectedRows: 1 }];
    if (/^UPDATE item_identifier/i.test(trimmed)) return [{ affectedRows: 1 }];
    return [[]];
  };

  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql, params) => answer(sql, params, calls.tx),
    query: async (sql, params) => answer(sql, params, calls.tx),
  };

  return {
    calls,
    execute: async (sql, params) => answer(sql, params, calls.execute),
    query: async (sql, params) => answer(sql, params, calls.execute),
    getConnection: async () => conn,
  };
}

const makeReq = (body, headers = { 's-company-lq': COMPANY }) => ({
  body,
  headers,
  header: (name) => headers[String(name).toLowerCase()],
  sqlStaffId: 900,
});

const allSql = (pool) => [...pool.calls.execute, ...pool.calls.tx];

describe('registerIdentifier', () => {
  it('normaliza el valor antes de guardarlo', async () => {
    const pool = makePool();
    const { registerIdentifier } = loadController(pool);
    const res = mockRes();

    await registerIdentifier(
      makeReq({ company_id: COMPANY, item_id: 100, id_type: 'epc', id_value: ' 3425e16cb4 ' }),
      res
    );

    assert.equal(res._code, 201, JSON.stringify(res._body));
    const insert = allSql(pool).find((c) => /^INSERT INTO item_identifier/i.test(c.sql));
    assert.ok(insert, 'debe insertar');
    assert.ok(insert.params.includes('3425E16CB4'), `valor sin normalizar: ${JSON.stringify(insert.params)}`);
  });

  it('rechaza un id_type fuera de la lista blanca', async () => {
    const pool = makePool();
    const { registerIdentifier } = loadController(pool);
    const res = mockRes();

    await registerIdentifier(
      makeReq({ company_id: COMPANY, item_id: 100, id_type: 'rfid-tag', id_value: 'AABB' }),
      res
    );

    assert.equal(res._code, 400);
    assert.equal(res._body.ok, false);
  });

  it('rechaza un valor vacío', async () => {
    const pool = makePool();
    const { registerIdentifier } = loadController(pool);
    const res = mockRes();

    await registerIdentifier(
      makeReq({ company_id: COMPANY, item_id: 100, id_type: 'epc', id_value: '   ' }),
      res
    );

    assert.equal(res._code, 400);
  });

  it('404 si el item no es de la compañía o está fuera del scope', async () => {
    const pool = makePool({ scopedItems: [] });
    const { registerIdentifier } = loadController(pool);
    const res = mockRes();

    await registerIdentifier(
      makeReq({ company_id: COMPANY, item_id: 999, id_type: 'epc', id_value: 'AABB' }),
      res
    );

    assert.equal(res._code, 404);
    assert.ok(!allSql(pool).some((c) => /^INSERT INTO item_identifier/i.test(c.sql)));
  });

  // El hallazgo de producción: 101 valores de serial resuelven a 2 items. Un
  // identificador escaneable que apunta a dos equipos no sirve para nada, así
  // que el segundo registro se rechaza NOMBRANDO al que ya lo tiene — que es la
  // alerta accionable, no un "duplicate entry" genérico.
  it('409 nombrando el item_id que ya tiene ese valor', async () => {
    const pool = makePool({
      existing: [{ id: 3, item_id: 555, id_type: 'barcode', id_value: '10001', is_active: 1 }],
    });
    const { registerIdentifier } = loadController(pool);
    const res = mockRes();

    await registerIdentifier(
      makeReq({ company_id: COMPANY, item_id: 100, id_type: 'barcode', id_value: '10001' }),
      res
    );

    assert.equal(res._code, 409);
    assert.equal(res._body.conflict.item_id, 555);
    assert.equal(res._body.conflict.id_value, '10001');
    assert.ok(!allSql(pool).some((c) => /^INSERT INTO item_identifier/i.test(c.sql)));
  });

  it('re-registrar el MISMO valor en el MISMO item no es conflicto', async () => {
    const pool = makePool({
      existing: [{ id: 3, item_id: 100, id_type: 'epc', id_value: 'AABB', is_active: 1 }],
    });
    const { registerIdentifier } = loadController(pool);
    const res = mockRes();

    await registerIdentifier(
      makeReq({ company_id: COMPANY, item_id: 100, id_type: 'epc', id_value: 'AABB' }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));
  });

  // El UNIQUE es (company_id, id_type, id_value) SIN is_active, así que una fila
  // desactivada sigue ocupando el valor: si un tag se despega de un equipo y se
  // pega en otro, hay que RECLAMAR la fila, no insertar una nueva (E11000).
  it('un valor liberado (is_active=0) se reclama con UPDATE, no con INSERT', async () => {
    const pool = makePool({
      existing: [{ id: 3, item_id: 555, id_type: 'epc', id_value: 'AABB', is_active: 0 }],
    });
    const { registerIdentifier } = loadController(pool);
    const res = mockRes();

    await registerIdentifier(
      makeReq({ company_id: COMPANY, item_id: 100, id_type: 'epc', id_value: 'AABB' }),
      res
    );

    assert.equal(res._code, 201, JSON.stringify(res._body));
    assert.ok(
      allSql(pool).some((c) => /^UPDATE item_identifier/i.test(c.sql)),
      'debe reclamar la fila inactiva'
    );
    assert.ok(!allSql(pool).some((c) => /^INSERT INTO item_identifier/i.test(c.sql)));
  });

  it('el company_id sale del contexto verificado, no del body', async () => {
    const pool = makePool();
    const { registerIdentifier } = loadController(pool);
    const res = mockRes();

    // El body miente: dice 999, el header dice 45. Gana el header (que además
    // se verifica contra la membresía en getStaffCompanyAccess).
    await registerIdentifier(
      makeReq({ company_id: 999, item_id: 100, id_type: 'epc', id_value: 'AABB' }),
      res
    );

    const insert = allSql(pool).find((c) => /^INSERT INTO item_identifier/i.test(c.sql));
    assert.ok(insert);
    assert.ok(!insert.params.includes(999), 'el company_id del body no debe llegar al INSERT');
    assert.ok(insert.params.some((p) => String(p) === COMPANY));
  });

  it('un rol con scope y sin asignaciones no registra nada (fail-closed)', async () => {
    // role_level 6 = inventory_location_manager, sin ubicaciones asignadas.
    const pool = makePool({ roleLevel: 6, scopedItems: [] });
    const { registerIdentifier } = loadController(pool);
    const res = mockRes();

    await registerIdentifier(
      makeReq({ company_id: COMPANY, item_id: 100, id_type: 'epc', id_value: 'AABB' }),
      res
    );

    assert.equal(res._code, 404);
    assert.ok(!allSql(pool).some((c) => /^INSERT INTO item_identifier/i.test(c.sql)));
  });
});

describe('registerIdentifiersBulk', () => {
  it('el pre-flight reporta los conflictos y aplica el resto, sin abortar el lote', async () => {
    const pool = makePool({
      scopedItems: [{ item_id: 100 }, { item_id: 101 }, { item_id: 102 }],
      existing: [{ id: 9, item_id: 555, id_type: 'epc', id_value: 'TOMADO', is_active: 1 }],
    });
    const { registerIdentifiersBulk } = loadController(pool);
    const res = mockRes();

    await registerIdentifiersBulk(
      makeReq({
        company_id: COMPANY,
        identifiers: [
          { item_id: 100, id_type: 'epc', id_value: 'LIBRE1' },
          { item_id: 101, id_type: 'epc', id_value: 'TOMADO' },
          { item_id: 102, id_type: 'epc', id_value: 'LIBRE2' },
        ],
      }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));
    assert.equal(res._body.registered, 2);
    assert.equal(res._body.conflicts.length, 1);
    assert.equal(res._body.conflicts[0].id_value, 'TOMADO');
    // `item_id` es el que mandó el cliente, para que pueda emparejar el
    // conflicto con su propia entrada; el dueño del valor va aparte.
    assert.equal(res._body.conflicts[0].item_id, 101);
    assert.equal(res._body.conflicts[0].conflict_item_id, 555);
  });

  it('detecta duplicados DENTRO del mismo lote', async () => {
    const pool = makePool({ scopedItems: [{ item_id: 100 }, { item_id: 101 }] });
    const { registerIdentifiersBulk } = loadController(pool);
    const res = mockRes();

    await registerIdentifiersBulk(
      makeReq({
        company_id: COMPANY,
        identifiers: [
          { item_id: 100, id_type: 'epc', id_value: 'MISMO' },
          { item_id: 101, id_type: 'epc', id_value: 'MISMO' },
        ],
      }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));
    assert.equal(res._body.registered, 1);
    assert.equal(res._body.conflicts.length, 1);
    // El primero gana; el segundo reporta contra quién chocó.
    assert.equal(res._body.conflicts[0].item_id, 101);
    assert.equal(res._body.conflicts[0].conflict_item_id, 100);
  });

  it('rechaza un lote por encima del tope', async () => {
    const pool = makePool();
    const { registerIdentifiersBulk } = loadController(pool);
    const res = mockRes();

    const identifiers = Array.from({ length: 501 }, (_, i) => ({
      item_id: 100, id_type: 'epc', id_value: `V${i}`,
    }));

    await registerIdentifiersBulk(makeReq({ company_id: COMPANY, identifiers }), res);

    assert.equal(res._code, 400);
    assert.match(res._body.msg, /500/);
  });

  it('rechaza una lista vacía', async () => {
    const pool = makePool();
    const { registerIdentifiersBulk } = loadController(pool);
    const res = mockRes();

    await registerIdentifiersBulk(makeReq({ company_id: COMPANY, identifiers: [] }), res);

    assert.equal(res._code, 400);
  });
});

describe('getIdentifiersByItems', () => {
  it('consulta scopeada por compañía y devuelve las filas activas', async () => {
    const pool = makePool({
      existing: [{ item_id: 100, id_type: 'epc', id_value: 'AABB', is_active: 1 }],
    });
    const { getIdentifiersByItems } = loadController(pool);
    const res = mockRes();

    await getIdentifiersByItems(makeReq({ company_id: COMPANY, item_ids: [100, 101] }), res);

    assert.equal(res._code, 200, JSON.stringify(res._body));
    assert.equal(res._body.identifiers.length, 1);

    const select = allSql(pool).find((c) => /FROM item_identifier/i.test(c.sql));
    assert.ok(/company_id\s*=\s*\?/i.test(select.sql), 'debe filtrar por compañía');
    assert.ok(select.params.some((p) => String(p) === COMPANY));
  });

  it('rechaza una lista vacía de items', async () => {
    const pool = makePool();
    const { getIdentifiersByItems } = loadController(pool);
    const res = mockRes();

    await getIdentifiersByItems(makeReq({ company_id: COMPANY, item_ids: [] }), res);

    assert.equal(res._code, 400);
  });
});
