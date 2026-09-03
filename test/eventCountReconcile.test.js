/**
 * Fase 4 del plan de conteo por identificador (ver DESIGN_rfid_event_count.md § 8).
 *
 * El cierre de evento: el operador barre las cajas con el lector RFID (y escanea
 * con pistola lo que no tiene tag) y la pantalla reconcilia contra lo que el
 * evento tiene asignado.
 *
 * Dos operaciones separadas a propósito: `reconcile` es SOLO LECTURA y
 * repetible — el operador barre, ve qué falta, va a buscarlo y barre otra vez —
 * y `close` es la que escribe. Fusionarlas haría que el segundo barrido
 * intentara devolver equipos ya devueltos.
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
  const ctrlPath = resolve('mysql/controllers/eventCount.js');
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
const EVENT = 123;

const item = (item_id, serial_number, epc = null) => ({
  item_id, serial_number, epc, category_name: 'Receivers', item_group: 'RX-100',
});

function makePool({ roleLevel = 1, expected = [], elsewhere = [], locations = null } = {}) {
  const calls = { execute: [], tx: [] };

  const answer = (sql, params, sink) => {
    const trimmed = sql.trim();
    sink.push({ sql: trimmed, params });

    if (/FROM company_staff/i.test(trimmed)) {
      return [[{
        company_staff_id: 'cs-test', role_type: 'admin', role_level: roleLevel,
        location_ids: locations, category_ids: null,
      }]];
    }
    if (/staff_location_access|staff_category_access/i.test(trimmed)) return [[]];
    // El conjunto esperado: lo que el evento tiene asignado.
    if (/FROM item_inv_assigned_event/i.test(trimmed) && /^SELECT/i.test(trimmed)) return [expected];
    // Clasificación de lo escaneado que no era del evento.
    if (/UNION/i.test(trimmed)) return [elsewhere];
    if (/FOR UPDATE/i.test(trimmed)) return [expected.map((row) => ({ item_id: row.item_id }))];
    if (/^UPDATE item_inv/i.test(trimmed)) return [{ affectedRows: 1 }];
    if (/^DELETE FROM item_inv_assigned_event/i.test(trimmed)) return [{ affectedRows: 1 }];
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

describe('reconcileEventCount', () => {
  it('el wow: 48 de 50, y dice cuáles faltan', async () => {
    const expected = [
      item(1, '10001', '3425E16CB4'),
      item(2, '10002', '3425E16CB5'),
      item(3, '10003', '3425E16CB6'), // con tag y no respondió -> alarma
      item(4, '10004'),               // sin tag -> verificar a mano
    ];
    const pool = makePool({ expected });
    const { reconcileEventCount } = loadController(pool);
    const res = mockRes();

    await reconcileEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['3425E16CB4', '3425E16CB5'] }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));
    assert.equal(res._body.summary.expected, 4);
    assert.equal(res._body.summary.matched, 2);
    assert.equal(res._body.summary.missing, 2);
    assert.deepEqual(res._body.missing_tagged.map((r) => r.item_id), [3]);
    assert.deepEqual(res._body.missing_untagged.map((r) => r.item_id), [4]);
  });

  // item_inv_assigned_event NO tiene company_id: el scope multi-tenant sale del
  // JOIN a item_inv. Sin él, la consulta cruza compañías.
  it('el SQL del conjunto esperado hace JOIN a item_inv y filtra por compañía', async () => {
    const pool = makePool({ expected: [item(1, '10001', 'AABB')] });
    const { reconcileEventCount } = loadController(pool);

    await reconcileEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['AABB'] }),
      mockRes()
    );

    const q = allSql(pool).find((c) => /FROM item_inv_assigned_event/i.test(c.sql));
    assert.ok(q, 'debe consultar el conjunto esperado');
    assert.ok(/JOIN\s+item_inv\b/i.test(q.sql), 'falta el JOIN a item_inv: sería cross-tenant');
    assert.ok(/ii\.company_id\s*=\s*\?/i.test(q.sql), 'debe filtrar por company_id de item_inv');
    assert.ok(q.params.some((p) => String(p) === COMPANY));
  });

  it('el company_id sale del contexto verificado, no del body', async () => {
    const pool = makePool({ expected: [] });
    const { reconcileEventCount } = loadController(pool);
    const res = mockRes();

    await reconcileEventCount(
      makeReq({ event_id: EVENT, company_id: 999, scanned: ['AABB'] }),
      res
    );

    // El body dice 999 y el header 45: es una discrepancia, no una preferencia.
    // Dejar pasar una de las dos daría 403 incomprensibles (authorizePermission
    // lee del body, resolveCompanyContext prefiere el header).
    assert.equal(res._code, 400);
    assert.match(res._body.msg, /company/i);
    // Los dos valores van en la respuesta: el frontend los toma de dos almacenes
    // distintos (header de localStorage, body de Redux) y sin verlos esto parece
    // un bug de permisos.
    assert.equal(String(res._body.detail.header), COMPANY);
    assert.equal(res._body.detail.body, 999);
  });

  it('un rol con scope y sin asignaciones no resuelve nada (fail-closed)', async () => {
    // role_level 6 = inventory_location_manager SIN asignaciones. `location_ids`
    // sale de un GROUP_CONCAT, así que la ausencia es NULL — no una lista vacía.
    const pool = makePool({ roleLevel: 6, locations: null, expected: [] });
    const { reconcileEventCount } = loadController(pool);
    const res = mockRes();

    await reconcileEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['AABB'] }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));
    assert.equal(res._body.summary.expected, 0);
    assert.equal(res._body.summary.matched, 0);

    const q = allSql(pool).find((c) => /FROM item_inv_assigned_event/i.test(c.sql));
    assert.ok(/1=0/.test(q.sql), 'el filtro de scope fail-closed debe estar en el SQL');
  });

  it('separa lo escaneado ajeno: foreign (de la compañía, otro evento) vs unknown', async () => {
    const pool = makePool({
      expected: [item(1, '10001', 'AABB')],
      elsewhere: [{ value: 'CCDD', item_id: 77 }],
    });
    const { reconcileEventCount } = loadController(pool);
    const res = mockRes();

    await reconcileEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['AABB', 'CCDD', 'ZZZZ'] }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));
    assert.deepEqual(res._body.foreign, [{ id_value: 'CCDD', item_id: 77 }]);
    assert.deepEqual(res._body.unknown, ['ZZZZ']);
  });

  it('no consulta la clasificación si todo lo escaneado era del evento', async () => {
    const pool = makePool({ expected: [item(1, '10001', 'AABB')] });
    const { reconcileEventCount } = loadController(pool);

    await reconcileEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['AABB'] }),
      mockRes()
    );

    assert.ok(!allSql(pool).some((c) => /UNION/i.test(c.sql)), 'consulta de más');
  });

  // El caso que el proyecto existe para resolver: 101 valores de serial en
  // producción resuelven a 2 items. Si los dos están en el mismo evento,
  // escanear ese código no identifica a ninguno.
  it('reporta la ambigüedad en vez de dar por presentes a los dos', async () => {
    const pool = makePool({
      expected: [item(1, '10001'), item(2, '10001')],
    });
    const { reconcileEventCount } = loadController(pool);
    const res = mockRes();

    await reconcileEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['10001'] }),
      res
    );

    assert.equal(res._body.summary.matched, 0);
    assert.equal(res._body.summary.ambiguous, 1);
    assert.equal(res._body.ambiguous[0].value, '10001');
    assert.deepEqual(res._body.ambiguous[0].item_ids.sort(), [1, 2]);
  });

  // El tope es 2000 y no 500 como el resto de los endpoints: reconciliar no es
  // una operación por valor, así que trocear produciría un `missing` parcial —
  // los valores que quedaron fuera del lote vuelven marcados como faltantes.
  // `scanned` tiene que ser el barrido completo.
  it('acepta un barrido grande de una sola vez', async () => {
    const pool = makePool({ expected: [item(1, '10001', 'AABB')] });
    const { reconcileEventCount } = loadController(pool);
    const res = mockRes();

    await reconcileEventCount(
      makeReq({
        event_id: EVENT,
        company_id: COMPANY,
        scanned: ['AABB', ...Array.from({ length: 1500 }, (_, i) => `V${i}`)],
      }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));
    assert.equal(res._body.summary.matched, 1);
  });

  it('rechaza un barrido por encima del tope', async () => {
    const pool = makePool();
    const { reconcileEventCount } = loadController(pool);
    const res = mockRes();

    await reconcileEventCount(
      makeReq({
        event_id: EVENT,
        company_id: COMPANY,
        scanned: Array.from({ length: 2001 }, (_, i) => `V${i}`),
      }),
      res
    );

    assert.equal(res._code, 400);
    assert.match(res._body.msg, /2000/);
  });

  it('exige event_id', async () => {
    const pool = makePool();
    const { reconcileEventCount } = loadController(pool);
    const res = mockRes();

    await reconcileEventCount(makeReq({ company_id: COMPANY, scanned: ['AABB'] }), res);

    assert.equal(res._code, 400);
  });

  it('no escribe nada: es repetible', async () => {
    const pool = makePool({ expected: [item(1, '10001', 'AABB')] });
    const { reconcileEventCount } = loadController(pool);

    await reconcileEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['AABB'] }),
      mockRes()
    );

    const writes = allSql(pool).filter((c) => /^(UPDATE|DELETE|INSERT)/i.test(c.sql));
    assert.deepEqual(writes, [], `reconcile escribió: ${JSON.stringify(writes)}`);
  });
});

describe('closeEventCount', () => {
  it('cierre parcial: devuelve los presentes y deja asignados los faltantes', async () => {
    const expected = [
      item(1, '10001', '3425E16CB4'),
      item(2, '10002', '3425E16CB5'),
      item(3, '10003', '3425E16CB6'), // no apareció
    ];
    const pool = makePool({ expected });
    const { closeEventCount } = loadController(pool);
    const res = mockRes();

    await closeEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['3425E16CB4', '3425E16CB5'] }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));

    const update = allSql(pool).find((c) => /^UPDATE item_inv/i.test(c.sql));
    assert.ok(update, 'debe devolver los presentes a bodega');
    assert.ok(/warehouse\s*=\s*1/i.test(update.sql));
    // Solo los dos resueltos, nunca el faltante.
    assert.ok(update.params.includes(1) && update.params.includes(2));
    assert.ok(!update.params.includes(3), 'el faltante NO debe volver a bodega');

    const del = allSql(pool).find((c) => /^DELETE FROM item_inv_assigned_event/i.test(c.sql));
    assert.ok(del.params.includes(1) && del.params.includes(2));
    assert.ok(!del.params.includes(3), 'el faltante debe quedar asignado al evento');

    assert.equal(res._body.summary.missing, 1);
    assert.deepEqual(res._body.missing_tagged.map((r) => r.item_id), [3]);
  });

  it('sin nada resuelto no escribe: no hay UPDATE ni DELETE vacío', async () => {
    const pool = makePool({ expected: [item(1, '10001', '3425E16CB4')] });
    const { closeEventCount } = loadController(pool);
    const res = mockRes();

    await closeEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['NADA'] }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));
    assert.equal(res._body.returned_items, 0);
    assert.ok(!allSql(pool).some((c) => /^UPDATE item_inv/i.test(c.sql)));
    assert.ok(!allSql(pool).some((c) => /^DELETE FROM/i.test(c.sql)));
  });

  it('bloquea las filas antes de tocarlas', async () => {
    const pool = makePool({ expected: [item(1, '10001', 'AABB')] });
    const { closeEventCount } = loadController(pool);

    await closeEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['AABB'] }),
      mockRes()
    );

    const sqls = allSql(pool).map((c) => c.sql);
    const lockAt = sqls.findIndex((s) => /FOR UPDATE/i.test(s));
    const updateAt = sqls.findIndex((s) => /^UPDATE item_inv/i.test(s));
    assert.ok(lockAt >= 0, 'debe bloquear con FOR UPDATE');
    assert.ok(lockAt < updateAt, 'el lock debe ir ANTES del UPDATE');
  });

  it('el DELETE va scopeado por evento y por los ids resueltos', async () => {
    const pool = makePool({ expected: [item(1, '10001', 'AABB')] });
    const { closeEventCount } = loadController(pool);

    await closeEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['AABB'] }),
      mockRes()
    );

    const del = allSql(pool).find((c) => /^DELETE FROM item_inv_assigned_event/i.test(c.sql));
    assert.ok(/event_id\s*=\s*\?/i.test(del.sql));
    assert.ok(del.params.includes(EVENT));
  });

  // No hace falta item_group ni category_name, a diferencia de
  // returnEventDevicesToWarehouse: el identificador ya es inequívoco. Eso
  // habilita el pelican mixto barrido de una pasada.
  it('no exige item_group ni category_name', async () => {
    const pool = makePool({
      expected: [
        { item_id: 1, serial_number: '10001', epc: 'AABB', category_name: 'Receivers', item_group: 'RX' },
        { item_id: 2, serial_number: '20001', epc: 'CCDD', category_name: 'Transmitters', item_group: 'TX' },
      ],
    });
    const { closeEventCount } = loadController(pool);
    const res = mockRes();

    await closeEventCount(
      makeReq({ event_id: EVENT, company_id: COMPANY, scanned: ['AABB', 'CCDD'] }),
      res
    );

    assert.equal(res._code, 200, JSON.stringify(res._body));
    assert.equal(res._body.summary.matched, 2, 'dos categorías distintas en una sola llamada');
  });
});
