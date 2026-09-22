/**
 * Fase 4a — pruebas de integración de los dos puntos donde item.js consume
 * los resolvers de mysql/controllers/sub_location.js (ver test/subLocationPath.test.js
 * para la lógica pura):
 *
 *  - insertingItem: persiste sub_location_id (columna nueva) además del JSON
 *    legacy, tanto para nombre simple como para path multinivel.
 *  - consultingCompanyInventoryBasedOnLocationAndSubLocation: filtra por
 *    sub_location_id cuando el path resuelve completo contra sub_locations,
 *    y cae al filtro JSON legacy cuando no (sin location_id, o path no
 *    registrado todavía) — sin regresión respecto al comportamiento anterior.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const loggerStub = { warn: () => {}, error: () => {}, info: () => {} };

function resolve(rel) {
  return path.resolve(__dirname, '..', rel);
}

function loadItemController(poolImpl) {
  const loggerPath = resolve('helpers/logger.js');
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true, exports: loggerStub,
  };
  const connPath = resolve('mysql/database/config.js');
  const ctrlPath = resolve('mysql/controllers/item.js');
  delete require.cache[connPath];
  delete require.cache[ctrlPath];
  require.cache[connPath] = {
    id: connPath, filename: connPath, loaded: true,
    exports: () => poolImpl,
  };
  return require(ctrlPath);
}

function mockRes() {
  const res = {};
  res.status = (code) => { res._code = code; return res; };
  res.json   = (body)  => { res._body = body; return res; };
  return res;
}

// ── mock genérico de conexión de transacción (insertingItem usa pool.getConnection()) ──

function makeTxPool({ locationRow = { location_id: 5 }, existingSubLocations = {} } = {}) {
  const calls = { execute: [] };
  let nextSubLocId = 100;

  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql, params) => {
      const trimmed = sql.trim();
      calls.execute.push({ sql: trimmed, params });

      if (/^SELECT location_id FROM locations/i.test(trimmed)) {
        return [locationRow ? [locationRow] : []];
      }
      if (/^SELECT sub_location_id, name FROM sub_locations/i.test(trimmed)) {
        const [location_id, name] = params;
        const parent_id = params.length > 2 ? params[2] : null;
        const key = `${location_id}|${name}|${parent_id ?? 'null'}`;
        const found = existingSubLocations[key];
        return [found ? [{ sub_location_id: found, name }] : []];
      }
      if (/^INSERT INTO sub_locations/i.test(trimmed)) {
        return [{ insertId: nextSubLocId++ }];
      }
      if (/^INSERT INTO item_inv/i.test(trimmed)) {
        return [{ insertId: 999, affectedRows: 1 }];
      }
      return [[]];
    },
  };

  // Pool-level execute is used by the scope write-gate (getStaffCompanyAccess /
  // canWriteInScope). Return a full-access role (level 1) so the gate is a no-op
  // in these sub_location-persistence tests (equivalent to the pre-gate behavior).
  const poolExecute = async (sql) => {
    if (/FROM company_staff/i.test(sql)) {
      return [[{ company_staff_id: "cs-test", role_type: "admin", role_level: 1, location_ids: null, category_ids: null }]];
    }
    return [[]];
  };

  return { calls, getConnection: async () => conn, execute: poolExecute };
}

describe('insertingItem — persiste sub_location_id (Fase 4a)', () => {
  function baseBody(overrides = {}) {
    return {
      category_name: 'Cameras', item_group: 'DSLR', cost: '100', brand: 'Canon',
      descript_item: 'desc', ownership: 'owned', main_warehouse: 'main',
      serial_number: 'SN-1', warehouse: false, company: 'ACME',
      location: 'Miami', company_id: 5,
      ...overrides,
    };
  }

  function findItemInvInsert(executeCalls) {
    return executeCalls.find((c) => /^INSERT INTO item_inv/i.test(c.sql));
  }
  function columnIndex(sql, columnName) {
    const cols = sql.match(/INSERT INTO item_inv\s*\(([\s\S]*?)\)\s*VALUES/i)[1]
      .split(',').map((c) => c.trim());
    return cols.indexOf(columnName);
  }

  it('nombre simple (sub_location_name) crea/resuelve 1 nodo y lo persiste', async () => {
    const pool = makeTxPool();
    const { insertingItem } = loadItemController(pool);

    const req = { sqlStaffId: 1, body: baseBody({ sub_location_name: 'Dc Office' }) };
    const res = mockRes();

    await insertingItem(req, res);

    assert.equal(res._code, 201, JSON.stringify(res._body));
    const insertCall = findItemInvInsert(pool.calls.execute);
    const idx = columnIndex(insertCall.sql, 'sub_location_id');
    assert.equal(insertCall.params[idx], 100, 'debe persistir el id creado para Dc Office');
    assert.equal(res._body.item.sub_location_id, 100);
  });

  it('path multinivel (array) resuelve la cadena completa y persiste la hoja', async () => {
    const pool = makeTxPool();
    const { insertingItem } = loadItemController(pool);

    const req = { sqlStaffId: 1, body: baseBody({ sub_location: ['Building A', 'Floor 3', 'Room 35'] }) };
    const res = mockRes();

    await insertingItem(req, res);

    assert.equal(res._code, 201, JSON.stringify(res._body));
    const subLocInserts = pool.calls.execute.filter((c) => /^INSERT INTO sub_locations/i.test(c.sql));
    assert.equal(subLocInserts.length, 3, 'crea los 3 niveles');

    const insertCall = findItemInvInsert(pool.calls.execute);
    const idx = columnIndex(insertCall.sql, 'sub_location_id');
    assert.equal(insertCall.params[idx], 102, 'persiste el id de la hoja (Room 35)');

    // el JSON legacy se sigue escribiendo tal cual vino
    const subIdx = columnIndex(insertCall.sql, 'sub_location');
    assert.deepEqual(insertCall.params[subIdx], ['Building A', 'Floor 3', 'Room 35']);
  });

  it('reutiliza nodos existentes del árbol en vez de duplicarlos', async () => {
    const pool = makeTxPool({
      existingSubLocations: { '5|Building A|null': 10 },
    });
    const { insertingItem } = loadItemController(pool);

    const req = { sqlStaffId: 1, body: baseBody({ sub_location: ['Building A', 'Floor 3'] }) };
    const res = mockRes();

    await insertingItem(req, res);

    const subLocInserts = pool.calls.execute.filter((c) => /^INSERT INTO sub_locations/i.test(c.sql));
    assert.equal(subLocInserts.length, 1, 'Building A ya existe, solo crea Floor 3');
    assert.equal(subLocInserts[0].params[2], 10, 'Floor 3 cuelga del Building A existente');
  });

  it('path con data sucia [null,null,null] → sub_location_id NULL, no rompe el insert', async () => {
    const pool = makeTxPool();
    const { insertingItem } = loadItemController(pool);

    const req = { sqlStaffId: 1, body: baseBody({ sub_location: [null, null, null] }) };
    const res = mockRes();

    await insertingItem(req, res);

    assert.equal(res._code, 201, JSON.stringify(res._body));
    const subLocInserts = pool.calls.execute.filter((c) => /^INSERT INTO sub_locations/i.test(c.sql));
    assert.equal(subLocInserts.length, 0, 'no crea nodos basura para [null,null,null]');

    const insertCall = findItemInvInsert(pool.calls.execute);
    const idx = columnIndex(insertCall.sql, 'sub_location_id');
    assert.equal(insertCall.params[idx], null);
  });

  it('sin sub_location ni sub_location_name → sub_location_id NULL (comportamiento previo intacto)', async () => {
    const pool = makeTxPool();
    const { insertingItem } = loadItemController(pool);

    const req = { sqlStaffId: 1, body: baseBody() };
    const res = mockRes();

    await insertingItem(req, res);

    assert.equal(res._code, 201, JSON.stringify(res._body));
    const insertCall = findItemInvInsert(pool.calls.execute);
    const idx = columnIndex(insertCall.sql, 'sub_location_id');
    assert.equal(insertCall.params[idx], null);
  });
});

// ── consultingCompanyInventoryBasedOnLocationAndSubLocation ─────────────────────

describe('consultingCompanyInventoryBasedOnLocationAndSubLocation — filtro con fallback (Fase 4a)', () => {
  const TREE = [
    { sub_location_id: 10, location_id: 5, name: 'Building A', parent_id: null },
    { sub_location_id: 11, location_id: 5, name: 'Floor 3',    parent_id: 10 },
    { sub_location_id: 12, location_id: 5, name: 'Room 35',    parent_id: 11 },
  ];

  function makeQueryPool({ treeRows = TREE, itemRows = [{ item_id: 1 }], locationRow = null } = {}) {
    const calls = { execute: [] };
    const pool = {
      execute: async (sql, params) => {
        const trimmed = sql.trim();
        calls.execute.push({ sql: trimmed, params });
        if (/^SELECT location_id FROM locations/i.test(trimmed)) {
          return [locationRow ? [locationRow] : []];
        }
        if (/^SELECT sub_location_id, name, parent_id/i.test(trimmed)) {
          return [treeRows];
        }
        if (/^SELECT \* FROM item_inv/i.test(trimmed)) {
          return [itemRows];
        }
        return [[]];
      },
    };
    return { calls, ...pool };
  }

  it('con location_id y path que resuelve completo, filtra por sub_location_id IN (...)', async () => {
    const pool = makeQueryPool();
    const { consultingCompanyInventoryBasedOnLocationAndSubLocation } = loadItemController(pool);

    const req = {
      body: { company_id: 5, location_id: 5 },
      query: { sub_location: 'Building A,Floor 3' },
    };
    const res = mockRes();

    await consultingCompanyInventoryBasedOnLocationAndSubLocation(req, res);

    const finalQuery = pool.calls.execute.find((c) => /^SELECT \* FROM item_inv/i.test(c.sql));
    assert.match(finalQuery.sql, /sub_location_id IN \(\?,\?\)/);
    assert.deepEqual(finalQuery.params.slice(-2), [11, 12], 'Floor 3 + su hijo Room 35 (subárbol completo)');
    assert.equal(res._code, 201);
  });

  it('sin location_id pero con company_id + location (nombre, como manda el frontend real), resuelve el id y activa el fast-path', async () => {
    const pool = makeQueryPool({ locationRow: { location_id: 5 } });
    const { consultingCompanyInventoryBasedOnLocationAndSubLocation } = loadItemController(pool);

    // Shape real del frontend (LocationDetail/Table.jsx): manda `location` (nombre), no location_id.
    const req = {
      body: { company_id: 5, location: 'miami' },
      query: { sub_location: 'Building A,Floor 3' },
    };
    const res = mockRes();

    await consultingCompanyInventoryBasedOnLocationAndSubLocation(req, res);

    const locationLookup = pool.calls.execute.find((c) => /^SELECT location_id FROM locations/i.test(c.sql));
    assert.deepEqual(locationLookup.params, [5, 'miami']);

    const finalQuery = pool.calls.execute.find((c) => /^SELECT \* FROM item_inv/i.test(c.sql));
    assert.match(finalQuery.sql, /sub_location_id IN \(\?,\?\)/, 'debe activar el fast-path con el id resuelto');
    assert.equal(res._code, 201);
  });

  it('company_id + location (nombre) que no existe en locations, cae al filtro JSON legacy sin romper', async () => {
    const pool = makeQueryPool({ locationRow: null }); // getLocationId no encuentra nada
    const { consultingCompanyInventoryBasedOnLocationAndSubLocation } = loadItemController(pool);

    const req = {
      body: { company_id: 5, location: 'nonexistent-city' },
      query: { sub_location: 'Building A,Floor 3' },
    };
    const res = mockRes();

    await consultingCompanyInventoryBasedOnLocationAndSubLocation(req, res);

    const finalQuery = pool.calls.execute.find((c) => /^SELECT \* FROM item_inv/i.test(c.sql));
    assert.match(finalQuery.sql, /JSON_UNQUOTE\(JSON_EXTRACT/, 'sin location_id resoluble, cae al filtro legacy');
    assert.equal(res._code, 201);
  });

  it('con location_id pero path NO registrado en sub_locations, cae al filtro JSON legacy', async () => {
    const pool = makeQueryPool({ treeRows: [] }); // árbol vacío -> no resuelve
    const { consultingCompanyInventoryBasedOnLocationAndSubLocation } = loadItemController(pool);

    const req = {
      body: { company_id: 5, location_id: 5 },
      query: { sub_location: 'Nonexistent,Path' },
    };
    const res = mockRes();

    await consultingCompanyInventoryBasedOnLocationAndSubLocation(req, res);

    const finalQuery = pool.calls.execute.find((c) => /^SELECT \* FROM item_inv/i.test(c.sql));
    assert.match(finalQuery.sql, /JSON_UNQUOTE\(JSON_EXTRACT/, 'debe caer al filtro legacy, sin perder resultados');
    assert.equal(res._code, 201);
  });

  it('sin location_id en el body, usa directo el filtro JSON legacy (no intenta resolver)', async () => {
    const pool = makeQueryPool();
    const { consultingCompanyInventoryBasedOnLocationAndSubLocation } = loadItemController(pool);

    const req = {
      body: { company_id: 5 }, // sin location_id
      query: { sub_location: 'Building A,Floor 3' },
    };
    const res = mockRes();

    await consultingCompanyInventoryBasedOnLocationAndSubLocation(req, res);

    const treeQuery = pool.calls.execute.find((c) => /^SELECT sub_location_id, name, parent_id/i.test(c.sql));
    assert.equal(treeQuery, undefined, 'no debe consultar sub_locations sin location_id');
    const finalQuery = pool.calls.execute.find((c) => /^SELECT \* FROM item_inv/i.test(c.sql));
    assert.match(finalQuery.sql, /JSON_UNQUOTE\(JSON_EXTRACT/);
  });

  it('sin filtro de sub-locación (query.sub_location ausente), no toca la resolución en absoluto', async () => {
    const pool = makeQueryPool();
    const { consultingCompanyInventoryBasedOnLocationAndSubLocation } = loadItemController(pool);

    const req = { body: { company_id: 5, location_id: 5 }, query: {} };
    const res = mockRes();

    await consultingCompanyInventoryBasedOnLocationAndSubLocation(req, res);

    const treeQuery = pool.calls.execute.find((c) => /^SELECT sub_location_id, name, parent_id/i.test(c.sql));
    assert.equal(treeQuery, undefined);
    const finalQuery = pool.calls.execute.find((c) => /^SELECT \* FROM item_inv/i.test(c.sql));
    assert.doesNotMatch(finalQuery.sql, /sub_location/i);
  });
});
