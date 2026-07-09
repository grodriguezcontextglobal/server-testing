/**
 * Fase 4a del plan de acción de performance SQL.
 * Normaliza item_inv.sub_location (JSON array de nombres = path raíz→hoja) a una
 * columna sub_location_id (INT) que apunta al nodo HOJA del path en la tabla
 * `sub_locations` (árbol por parent_id, scopeado por location_id).
 *
 * La lógica pura + los resolvers viven en mysql/controllers/sub_location.js
 * (módulo liviano, sin dependencias de Redis) y son consumidos por item.js.
 *
 * Modelo confirmado con el usuario:
 *   - Un item tiene UN path jerárquico (ej. [Building A, Floor 3, Room 35, Shell X]),
 *     no múltiples sub-locaciones independientes → una sola FK a la hoja.
 *   - Los nombres se repiten entre locaciones → todo se resuelve por (location_id + cadena parent_id).
 *   - Segmentos null/vacíos (data sucia: 3089 items con [null,null,null]) cortan el walk → hoja null.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const loggerStub = { warn: () => {}, error: () => {}, info: () => {} };

function loadSubLocation() {
  const root = path.resolve(__dirname, '..');
  const loggerPath = path.join(root, 'helpers/logger.js');
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true, exports: loggerStub,
  };
  // sub_location.js llama getConnection() dentro de cada handler, no al cargar,
  // así que no hace falta stubbear config para las funciones puras.
  return require('../mysql/controllers/sub_location');
}

const { walkSubLocationPath, collectSubtreeIds, processSubLocationPath, resolveSubLocationFilter } =
  loadSubLocation();

// Árbol de ejemplo (una locación Miami, location_id=1):
//   Building A (10)
//     ├─ Floor 3 (11) ─ Room 35 (12) ─ Shell A-1 (13)
//     └─ Floor 9 (14) ─ Room 22 (15)
// Otra locación Denver (location_id=2) con MISMO nombre de raíz:
//   Building A (20) ─ Floor 33 (21)
const TREE = [
  { sub_location_id: 10, location_id: 1, name: 'Building A', parent_id: null },
  { sub_location_id: 11, location_id: 1, name: 'Floor 3',    parent_id: 10 },
  { sub_location_id: 12, location_id: 1, name: 'Room 35',    parent_id: 11 },
  { sub_location_id: 13, location_id: 1, name: 'Shell A-1',  parent_id: 12 },
  { sub_location_id: 14, location_id: 1, name: 'Floor 9',    parent_id: 10 },
  { sub_location_id: 15, location_id: 1, name: 'Room 22',    parent_id: 14 },
];

describe('walkSubLocationPath (pure)', () => {
  it('resuelve el path completo hasta la hoja', () => {
    const r = walkSubLocationPath(TREE, ['Building A', 'Floor 3', 'Room 35', 'Shell A-1']);
    assert.equal(r.leafId, 13);
    assert.equal(r.matchedDepth, 4);
  });

  it('resuelve un prefijo parcial (deepest match) cuando el path es más corto', () => {
    const r = walkSubLocationPath(TREE, ['Building A', 'Floor 3']);
    assert.equal(r.leafId, 11);
    assert.equal(r.matchedDepth, 2);
  });

  it('corta en el primer segmento que no matchea contra la cadena parent_id', () => {
    const r = walkSubLocationPath(TREE, ['Building A', 'Floor 99', 'Room 35']);
    assert.equal(r.leafId, 10, 'se queda en Building A (deepest match real)');
    assert.equal(r.matchedDepth, 1);
  });

  it('respeta la jerarquía: Room 22 solo cuelga de Floor 9, no de Floor 3', () => {
    const ok = walkSubLocationPath(TREE, ['Building A', 'Floor 9', 'Room 22']);
    assert.equal(ok.leafId, 15);
    // El mismo Room 22 NO debe resolver bajo Floor 3 (no es su hijo)
    const bad = walkSubLocationPath(TREE, ['Building A', 'Floor 3', 'Room 22']);
    assert.equal(bad.leafId, 11, 'corta en Floor 3, Room 22 no es hijo de Floor 3');
    assert.equal(bad.matchedDepth, 2);
  });

  it('segmentos null/vacíos (data sucia [null,null,null]) → sin hoja', () => {
    assert.equal(walkSubLocationPath(TREE, [null, null, null]).leafId, null);
    assert.equal(walkSubLocationPath(TREE, ['', '  ']).leafId, null);
    assert.equal(walkSubLocationPath(TREE, []).leafId, null);
    assert.equal(walkSubLocationPath(TREE, [null, null, null]).matchedDepth, 0);
  });

  it('hace trim de los nombres antes de comparar', () => {
    const r = walkSubLocationPath(TREE, ['  Building A ', ' Floor 3']);
    assert.equal(r.leafId, 11);
  });
});

describe('collectSubtreeIds (pure)', () => {
  it('devuelve el nodo raíz + todos sus descendientes', () => {
    const ids = collectSubtreeIds(TREE, 10).sort((a, b) => a - b);
    assert.deepEqual(ids, [10, 11, 12, 13, 14, 15]);
  });

  it('subárbol de un nodo intermedio', () => {
    const ids = collectSubtreeIds(TREE, 11).sort((a, b) => a - b);
    assert.deepEqual(ids, [11, 12, 13]);
  });

  it('hoja sin hijos → solo el nodo', () => {
    assert.deepEqual(collectSubtreeIds(TREE, 13), [13]);
  });
});

describe('processSubLocationPath (find-or-create chain)', () => {
  function mockConn(existingByKey) {
    const calls = { selects: [], inserts: [] };
    let nextId = 100;
    return {
      calls,
      execute: async (sql, params) => {
        if (/^SELECT/i.test(sql.trim())) {
          calls.selects.push(params);
          // key: location_id|name|parent_id
          const [location_id, name] = params;
          const parent_id = params.length > 2 ? params[2] : null;
          const key = `${location_id}|${name}|${parent_id ?? 'null'}`;
          const found = existingByKey[key];
          return [found ? [{ sub_location_id: found, name }] : []];
        }
        // INSERT
        calls.inserts.push(params);
        return [{ insertId: nextId++ }];
      },
    };
  }

  it('crea la cadena completa cuando nada existe, encadenando parent_id', async () => {
    const conn = mockConn({});
    const leaf = await processSubLocationPath(conn, 1, ['Building A', 'Floor 3', 'Room 35'], 133);
    assert.equal(conn.calls.inserts.length, 3, 'crea 3 nodos');
    // primer insert: parent null; segundo: parent = id del primero (100); tercero: parent = 101
    assert.equal(conn.calls.inserts[0][2], null);
    assert.equal(conn.calls.inserts[1][2], 100);
    assert.equal(conn.calls.inserts[2][2], 101);
    assert.equal(leaf, 102, 'devuelve el id de la hoja');
  });

  it('reutiliza nodos existentes (find), solo crea los que faltan', async () => {
    // Building A ya existe (id 10) bajo location 1, parent null
    const conn = mockConn({ '1|Building A|null': 10 });
    const leaf = await processSubLocationPath(conn, 1, ['Building A', 'Floor 3'], 133);
    assert.equal(conn.calls.inserts.length, 1, 'solo crea Floor 3');
    assert.equal(conn.calls.inserts[0][2], 10, 'Floor 3 cuelga de Building A existente');
    assert.equal(leaf, 100);
  });

  it('corta en el primer segmento null/vacío → devuelve null si no creó nada', async () => {
    const conn = mockConn({});
    const leaf = await processSubLocationPath(conn, 1, [null, null, null], 133);
    assert.equal(conn.calls.inserts.length, 0);
    assert.equal(leaf, null);
  });
});

describe('resolveSubLocationFilter (search-side, read-only)', () => {
  function mockConnWithTree(rows) {
    return { execute: async () => [rows] };
  }

  it('path totalmente resuelto → devuelve ids del subárbol (nodo + descendientes)', async () => {
    const conn = mockConnWithTree(TREE);
    const res = await resolveSubLocationFilter(conn, 1, ['Building A', 'Floor 3']);
    assert.ok(res, 'debe resolver');
    assert.deepEqual(res.ids.sort((a, b) => a - b), [11, 12, 13],
      'Floor 3 + Room 35 + Shell A-1 (prefijo → subárbol, preserva semántica del JSON viejo)');
  });

  it('path con segmento no registrado → null (señal de fallback al JSON viejo)', async () => {
    const conn = mockConnWithTree(TREE);
    const res = await resolveSubLocationFilter(conn, 1, ['Building A', 'Ghost Floor']);
    assert.equal(res, null, 'no resuelve del todo → caller cae al comportamiento JSON legacy');
  });

  it('path completo a una hoja → solo esa hoja', async () => {
    const conn = mockConnWithTree(TREE);
    const res = await resolveSubLocationFilter(conn, 1, ['Building A', 'Floor 9', 'Room 22']);
    assert.deepEqual(res.ids, [15]);
  });
});
