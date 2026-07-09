/**
 * Fase 4b del plan de acción de performance SQL (audit 2026-07-07 / datos 2026-07-08):
 * event_item_shipping.shipment_id pasa de vivir escondido dentro del JSON de
 * `notes` (vía JSON_SET / JSON_EXTRACT, no indexable) a ser una columna propia
 * indexada. Requiere que la migración
 * mysql/migrations/add_shipment_id_to_event_item_shipping.sql haya corrido
 * (agrega la columna + backfill) ANTES de este código.
 *
 * Cubre:
 *  - createShipment: linkea items al shipment escribiendo la columna nueva,
 *    ya no mete el id dentro de `notes` (eso además evitaba que un PATCH
 *    genérico de `notes` borrara el link sin querer).
 *  - getShipments: el JOIN usa la columna directa, no JSON_EXTRACT.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

function resolve(rel) {
  return path.resolve(__dirname, '..', rel);
}

const loggerStub = { warn: () => {}, error: () => {}, info: () => {} };

function loadShipmentController(poolImpl) {
  const loggerPath = resolve('helpers/logger.js');
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true, exports: loggerStub,
  };

  const connPath = resolve('mysql/database/config.js');
  const ctrlPath = resolve('mysql/controllers/shipment.js');
  delete require.cache[connPath];
  delete require.cache[ctrlPath];
  require.cache[connPath] = {
    id: connPath, filename: connPath, loaded: true,
    exports: () => poolImpl,
  };
  return require(ctrlPath);
}

function makeTrackedPool(queryImpl) {
  const calls = { query: [], beginTransaction: 0, commit: 0, rollback: 0, release: 0 };
  const conn = {
    query: async (sql, params) => {
      calls.query.push({ sql: sql.trim(), params });
      return queryImpl(sql.trim(), params, calls.query.length);
    },
    beginTransaction: async () => { calls.beginTransaction++; },
    commit:           async () => { calls.commit++; },
    rollback:         async () => { calls.rollback++; },
    release:          () => { calls.release++; },
  };
  return { calls, getConnection: async () => conn };
}

function mockRes() {
  const res = {};
  res.status = (code) => { res._code = code; return res; };
  res.json   = (body)  => { res._body = body; return res; };
  return res;
}

describe('createShipment (shipment.js)', () => {
  it('linkea los items del package_list escribiendo la columna shipment_id, no notes/JSON_SET', async () => {
    const pool = makeTrackedPool(async (sql) => {
      if (sql.startsWith('INSERT INTO company_shipments')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 2 }];
    });
    const { createShipment } = loadShipmentController(pool);

    const req = { body: {
      event_id: 'evt-1', company_id: 5, destination: 'Warehouse A',
      recipient_name: 'Jane', authorizer_name: 'John', courier: 'FedEx',
      tracking_number: 'TRACK123', package_list: [10, 11],
    } };
    const res = mockRes();

    await createShipment(req, res);

    assert.equal(res._code, 201);
    assert.ok(res._body.shipment_id, 'debe devolver el shipment_id generado');

    const linkCall = pool.calls.query.find((c) => c.sql.startsWith('UPDATE event_item_shipping'));
    assert.ok(linkCall, 'debe haber un UPDATE a event_item_shipping');
    assert.match(linkCall.sql, /SET shipment_id = \?/);
    assert.doesNotMatch(linkCall.sql, /JSON_SET/, 'ya no debe escribir el id dentro de notes');
    assert.deepEqual(linkCall.params, [res._body.shipment_id, 'evt-1', [10, 11]]);
  });
});

describe('getShipments (shipment.js)', () => {
  it('el JOIN usa la columna shipment_id directa, no JSON_EXTRACT sobre notes', async () => {
    const pool = makeTrackedPool(async () => [[{ shipment_id: 's1', package_list: '10,11' }]]);
    const { getShipments } = loadShipmentController(pool);

    const req = { body: { company_id: 5 } };
    const res = mockRes();

    await getShipments(req, res);

    assert.equal(res._code, 200);
    const call = pool.calls.query[0];
    assert.match(call.sql, /LEFT JOIN event_item_shipping eis ON eis\.shipment_id = cs\.shipment_id/);
    assert.doesNotMatch(call.sql, /JSON_EXTRACT/);
  });
});
