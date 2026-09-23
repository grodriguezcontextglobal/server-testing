'use strict';

/**
 * `POST /api/db_location/locations/:id` era anónimo y su sentencia era
 * `DELETE FROM locations WHERE location_id = ?`, sin cláusula de compañía. Las
 * dos cosas a la vez: cualquiera que alcanzara el host podía borrar la locación
 * de cualquier inquilino con solo acertar un id. Durante una auditoría un
 * agente automatizado hizo exactamente eso contra `location_id = 1` en
 * producción, y la API respondió 200 "Location deleted successfully".
 *
 * Lo que se afirma aquí es lo que no se ve leyendo el diff:
 *   - que el company_id sale de la FILA y no de quien llama, que es lo que
 *     permite autorizar una ruta que nombra su recurso solo por id;
 *   - que ese company_id llega de verdad al DELETE, así que el handler queda
 *     acotado por inquilino por su cuenta, no solo por la cadena de la ruta;
 *   - que un id desconocido responde 404 y no 400, para no confirmar la
 *     existencia de filas ajenas.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const controllerPath = path.resolve(__dirname, '../mysql/controllers/location.js');
const dbPath = path.resolve(__dirname, '../mysql/database/config.js');
const loggerPath = path.resolve(__dirname, '../helpers/logger.js');

function loadLocationController(pool) {
  const originals = new Map(
    [controllerPath, dbPath, loggerPath].map((p) => [p, require.cache[p]])
  );
  delete require.cache[controllerPath];
  require.cache[dbPath] = { exports: () => pool };
  require.cache[loggerPath] = { exports: { error() {}, info() {}, warn() {} } };
  const controller = require(controllerPath);
  return {
    controller,
    restore() {
      for (const [p, cached] of originals) {
        if (cached) require.cache[p] = cached;
        else delete require.cache[p];
      }
    },
  };
}

const makeRes = () => {
  const sent = {};
  return {
    sent,
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
  };
};

/** @param {{owner?: number|null, affectedRows?: number}} opts */
const makePool = ({ owner = 7, affectedRows = 1 } = {}) => {
  const queries = [];
  return {
    queries,
    pool: {
      async execute(sql, values) {
        const flat = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ sql: flat, values });
        if (flat.startsWith('SELECT company_id FROM locations')) {
          return [owner === null ? [] : [{ company_id: owner }]];
        }
        return [{ affectedRows }];
      },
    },
  };
};

test('resolveLocationCompanyId reads the owning company from the row', async () => {
  const { pool, queries } = makePool({ owner: 7 });
  const loaded = loadLocationController(pool);
  try {
    const req = { params: { id: '42' } };
    const res = makeRes();
    let advanced = false;

    await loaded.controller.resolveLocationCompanyId(req, res, () => { advanced = true; });

    assert.ok(advanced, 'debe continuar la cadena');
    assert.equal(req.body.company_id, 7, 'company_id sale de la fila, no del cliente');
    assert.equal(queries[0].values[0], '42');
  } finally {
    loaded.restore();
  }
});

test('resolveLocationCompanyId responde 404 (no 400) para un id desconocido', async () => {
  const { pool } = makePool({ owner: null });
  const loaded = loadLocationController(pool);
  try {
    const req = { params: { id: '999' } };
    const res = makeRes();
    let advanced = false;

    await loaded.controller.resolveLocationCompanyId(req, res, () => { advanced = true; });

    assert.equal(advanced, false, 'no debe continuar hacia el handler');
    assert.equal(res.sent.status, 404);
  } finally {
    loaded.restore();
  }
});

test('resolveLocationCompanyId no pisa un body existente', async () => {
  const { pool } = makePool({ owner: 7 });
  const loaded = loadLocationController(pool);
  try {
    const req = { params: { id: '42' }, body: { keep: 'me' } };
    const res = makeRes();

    await loaded.controller.resolveLocationCompanyId(req, res, () => {});

    assert.equal(req.body.keep, 'me');
    assert.equal(req.body.company_id, 7);
  } finally {
    loaded.restore();
  }
});

test('deleteLocation acota el DELETE por company_id', async () => {
  const { pool, queries } = makePool({ affectedRows: 1 });
  const loaded = loadLocationController(pool);
  try {
    const req = { params: { id: '42' }, body: { company_id: 7 } };
    const res = makeRes();

    await loaded.controller.deleteLocation(req, res);

    const del = queries.find((q) => q.sql.startsWith('DELETE FROM locations'));
    assert.ok(del, 'debe ejecutarse el DELETE');
    assert.match(del.sql, /WHERE location_id = \? AND company_id = \?/);
    assert.deepEqual(del.values, ['42', 7]);
    assert.equal(res.sent.status, 200);
  } finally {
    loaded.restore();
  }
});

test('deleteLocation rechaza si no hay contexto de compañía', async () => {
  const { pool, queries } = makePool();
  const loaded = loadLocationController(pool);
  try {
    const req = { params: { id: '42' }, body: {} };
    const res = makeRes();

    await loaded.controller.deleteLocation(req, res);

    assert.equal(res.sent.status, 400);
    assert.equal(
      queries.some((q) => q.sql.startsWith('DELETE FROM locations')),
      false,
      'ningún DELETE debe llegar a la base de datos'
    );
  } finally {
    loaded.restore();
  }
});

test('deleteLocation responde 404 cuando el id existe pero es de otra compañía', async () => {
  // affectedRows = 0: la fila existe, pero el AND company_id no casa.
  const { pool } = makePool({ affectedRows: 0 });
  const loaded = loadLocationController(pool);
  try {
    const req = { params: { id: '42' }, body: { company_id: 999 } };
    const res = makeRes();

    await loaded.controller.deleteLocation(req, res);

    assert.equal(res.sent.status, 404);
  } finally {
    loaded.restore();
  }
});
