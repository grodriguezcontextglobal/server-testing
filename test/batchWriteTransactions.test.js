/**
 * Fase 3 del plan de acción de performance SQL (audit 2026-07-07):
 * loops de INSERT/UPDATE ejecutados fila-por-fila, sin transacción, se
 * convierten en batch queries (o se envuelven en transacción cuando el
 * batching no es seguro) para reducir round-trips y evitar escrituras
 * parciales si el proceso falla a mitad del loop.
 *
 * Cubre:
 *  - containerItemsDetails (mysql/controllers/item.js): 2 UPDATEs con IN()
 *    en vez de N, dentro de una transacción.
 *  - updateGroupItems (mysql/controllers/company.js): 1 solo UPDATE con
 *    CASE/WHEN para el campo que varía por fila (serial_number).
 *  - insertingRecordInEventRefactored (mysql/controllers/recordEvent.js):
 *    mismo INSERT...SELECT por fila (no se puede colapsar a 1 query sin
 *    arriesgar el join), pero envuelto en transacción con rollback.
 */

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

function mockRes() {
  const res = {};
  res.status = (code) => { res._code = code; return res; };
  res.json   = (body)  => { res._body = body; return res; };
  return res;
}

function resolve(rel) {
  return path.resolve(__dirname, '..', rel);
}

const loggerStub = { warn: () => {}, error: () => {}, info: () => {} };

function stubLogger() {
  const loggerPath = resolve('helpers/logger.js');
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true, exports: loggerStub,
  };
}

// ─── loader genérico: swappea mysql/database/config.js y recarga el controller ──

function loadController(controllerRelPath, connectionImpl) {
  stubLogger();
  const connPath = resolve('mysql/database/config.js');
  const ctrlPath = resolve(controllerRelPath);
  delete require.cache[connPath];
  delete require.cache[ctrlPath];
  require.cache[connPath] = {
    id: connPath, filename: connPath, loaded: true,
    exports: () => connectionImpl,
  };
  return require(ctrlPath);
}

function makeTrackedConnection(executeImpl) {
  const calls = { execute: [], beginTransaction: 0, commit: 0, rollback: 0 };
  return {
    calls,
    execute: async (sql, params) => {
      calls.execute.push({ sql: sql.trim(), params });
      return executeImpl(sql.trim(), params, calls.execute.length);
    },
    beginTransaction: async () => { calls.beginTransaction++; },
    commit:           async () => { calls.commit++; },
    rollback:          async () => { calls.rollback++; },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// containerItemsDetails — mysql/controllers/item.js
// ════════════════════════════════════════════════════════════════════════════════

describe('containerItemsDetails (item.js)', () => {
  it('agrupa remove+add en 2 UPDATEs con IN() dentro de una transacción (no N updates)', async () => {
    const conn = makeTrackedConnection(async () => [{ affectedRows: 2 }]);
    const { containerItemsDetails } = loadController('mysql/controllers/item.js', conn);

    await containerItemsDetails({
      container_id: 55,
      remove: [{ item_id: 1 }, { item_id: 2 }],
      data:   [{ item_id: 3 }, { item_id: 4 }],
    });

    assert.equal(conn.calls.beginTransaction, 1, 'debe abrir una transacción');
    assert.equal(conn.calls.commit, 1, 'debe hacer commit al terminar');
    assert.equal(conn.calls.rollback, 0);
    assert.equal(conn.calls.execute.length, 2, 'debe ejecutar solo 2 UPDATEs (no 1 por item)');

    const [removeCall, addCall] = conn.calls.execute;
    assert.match(removeCall.sql, /UPDATE item_inv/);
    assert.match(removeCall.sql, /WHERE item_id IN \(\?,\?\)/);
    assert.deepEqual(removeCall.params, [null, 0, 1, 1, 2]);

    assert.match(addCall.sql, /WHERE item_id IN \(\?,\?\)/);
    assert.deepEqual(addCall.params, [55, 1, 0, 3, 4]);
  });

  it('omite el UPDATE de un lado si remove o data vienen vacíos', async () => {
    const conn = makeTrackedConnection(async () => [{ affectedRows: 1 }]);
    const { containerItemsDetails } = loadController('mysql/controllers/item.js', conn);

    await containerItemsDetails({ container_id: 9, remove: [], data: [{ item_id: 7 }] });

    assert.equal(conn.calls.execute.length, 1, 'solo debe correr el UPDATE de add');
    assert.deepEqual(conn.calls.execute[0].params, [9, 1, 0, 7]);
  });

  it('acepta remove/data como JSON string (contrato existente de props.remove/props.data)', async () => {
    const conn = makeTrackedConnection(async () => [{ affectedRows: 1 }]);
    const { containerItemsDetails } = loadController('mysql/controllers/item.js', conn);

    await containerItemsDetails({
      container_id: 3,
      remove: JSON.stringify([{ item_id: 1 }]),
      data:   JSON.stringify([{ item_id: 2 }]),
    });

    assert.equal(conn.calls.execute.length, 2);
  });

  it('hace rollback y relanza el error si un UPDATE falla — no deja el container a medias', async () => {
    const conn = makeTrackedConnection(async (_sql, _params, callIndex) => {
      if (callIndex === 2) throw new Error('DB down mid-batch');
      return [{ affectedRows: 1 }];
    });
    const { containerItemsDetails } = loadController('mysql/controllers/item.js', conn);

    await assert.rejects(
      () => containerItemsDetails({
        container_id: 1,
        remove: [{ item_id: 1 }],
        data:   [{ item_id: 2 }],
      }),
      /DB down mid-batch/
    );

    assert.equal(conn.calls.rollback, 1, 'debe hacer rollback si falla a mitad del batch');
    assert.equal(conn.calls.commit, 0, 'no debe commitear si hubo error');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// updateGroupItems — mysql/controllers/company.js
// ════════════════════════════════════════════════════════════════════════════════

describe('updateGroupItems (company.js)', () => {
  function baseReqBody(items) {
    return {
      category_name: 'Cameras', item_group: 'DSLR', cost: 100, brand: 'Canon',
      descript_item: 'desc', ownership: 'owned', main_warehouse: 'main',
      warehouse: 'wh1', company: 'ACME', location: 'loc1', sub_location: 'sub1',
      current_location: 'loc1', extra_serial_number: ['x'], company_id: 5,
      return_date: null, update_at: '2026-07-07', enableAssignFeature: 1,
      container: null, containerSpotLimit: null, image_url: null,
      data: JSON.stringify(items),
    };
  }

  it('agrupa todos los items en un solo UPDATE con CASE/WHEN para serial_number', async () => {
    const conn = makeTrackedConnection(async () => [{ affectedRows: 2 }]);
    const { updateGroupItems } = loadController('mysql/controllers/company.js', conn);

    const req = { body: baseReqBody([
      { item_id: 10, serial_number: 'A' },
      { item_id: 11, serial_number: 'B' },
    ]) };
    const res = mockRes();

    await updateGroupItems(req, res);

    assert.equal(conn.calls.execute.length, 1, 'debe ser 1 sola query para todo el batch');
    const { sql, params } = conn.calls.execute[0];
    assert.match(sql, /UPDATE item_inv/);
    assert.match(sql, /CASE item_id/);
    assert.match(sql, /WHERE item_id IN \(\?,\?\)/);

    // orden esperado: (item_id, serial_number) x N, luego los 20 campos compartidos, luego los item_ids del IN
    assert.deepEqual(params.slice(0, 4), [10, 'A', 11, 'B']);
    assert.equal(params.at(-2), 10);
    assert.equal(params.at(-1), 11);
    assert.equal(res._code, 200);
    assert.equal(res._body.ok, true);
  });

  it('omite items sin item_id y no los incluye en el CASE/IN', async () => {
    const conn = makeTrackedConnection(async () => [{ affectedRows: 1 }]);
    const { updateGroupItems } = loadController('mysql/controllers/company.js', conn);

    const req = { body: baseReqBody([
      { item_id: 10, serial_number: 'A' },
      { serial_number: 'sin-id' }, // sin item_id -> debe excluirse
    ]) };
    const res = mockRes();

    await updateGroupItems(req, res);

    assert.equal(conn.calls.execute.length, 1);
    assert.deepEqual(conn.calls.execute[0].params.slice(0, 2), [10, 'A']);
    assert.equal(res._code, 200);
  });

  it('si ningún item tiene item_id, no ejecuta query y responde 200 igual (comportamiento actual preservado)', async () => {
    const conn = makeTrackedConnection(async () => [{ affectedRows: 0 }]);
    const { updateGroupItems } = loadController('mysql/controllers/company.js', conn);

    const req = { body: baseReqBody([{ serial_number: 'sin-id' }]) };
    const res = mockRes();

    await updateGroupItems(req, res);

    assert.equal(conn.calls.execute.length, 0, 'no debe pegarle a la DB si no hay items válidos');
    assert.equal(res._code, 200);
    assert.equal(res._body.ok, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// insertingRecordInEventRefactored — mysql/controllers/recordEvent.js
// recordEvent.js captura `connection` a nivel de módulo (getConnection() al cargar),
// por eso hay que swappear el mock ANTES de requerir el módulo, igual que staff.js.
// ════════════════════════════════════════════════════════════════════════════════

describe('insertingRecordInEventRefactored (recordEvent.js)', () => {
  function baseBody(records) {
    return {
      event: 'evt-1',
      groupingInventoryByGroupName: { camera: [{ category: 'Cameras' }] },
      dataToStoreAsRecord: records,
    };
  }

  it('inserta todos los registros dentro de una transacción con 1 commit al final', async () => {
    const conn = makeTrackedConnection(async () => [{ affectedRows: 1 }]);
    const { insertingRecordInEventRefactored } = loadController('mysql/controllers/recordEvent.js', conn);

    const req = { body: baseBody([
      { device: { status: true, deviceType: 'camera', serialNumber: 'S1' }, paymentIntent: 'pi_1', user: 'a@x.com' },
      { device: { status: false, deviceType: 'camera', serialNumber: 'S2' }, paymentIntent: 'pi_2', user: 'b@x.com' },
    ]) };
    const res = mockRes();

    await insertingRecordInEventRefactored(req, res);

    assert.equal(conn.calls.beginTransaction, 1);
    assert.equal(conn.calls.commit, 1, 'debe commitear una sola vez al final del loop, no por fila');
    assert.equal(conn.calls.rollback, 0);
    assert.equal(conn.calls.execute.length, 2, 'sigue siendo 1 INSERT...SELECT por registro (join no es batcheable de forma segura)');
    assert.equal(res._code, 201);
    assert.equal(res._body.inserted_record, 2);
  });

  it('si una fila falla a mitad del loop, hace rollback de TODO el batch (antes quedaban inserts parciales)', async () => {
    const conn = makeTrackedConnection(async (_sql, _params, callIndex) => {
      if (callIndex === 2) throw new Error('constraint violation');
      return [{ affectedRows: 1 }];
    });
    const { insertingRecordInEventRefactored } = loadController('mysql/controllers/recordEvent.js', conn);

    const req = { body: baseBody([
      { device: { status: true, deviceType: 'camera', serialNumber: 'S1' }, paymentIntent: 'pi_1', user: 'a@x.com' },
      { device: { status: true, deviceType: 'camera', serialNumber: 'S2' }, paymentIntent: 'pi_2', user: 'b@x.com' },
    ]) };
    const res = mockRes();

    await insertingRecordInEventRefactored(req, res);

    assert.equal(conn.calls.rollback, 1, 'debe hacer rollback si una fila falla');
    assert.equal(conn.calls.commit, 0);
    assert.equal(res._code, 500, 'el handler sigue respondiendo 500 en error (contrato actual)');
  });
});
