'use strict';

// Regresión: POST /api/db_event/event_staff devolvía 408 "Request timeout".
// El catch de insertingStaffInEvent solo logueaba y nunca respondía, así que
// cualquier error de MySQL dejaba la petición colgada hasta que el middleware
// de timeout (index.js, 30s) contestaba 408 y tapaba el error real.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const connPath = path.join(root, 'mysql/database/config.js');
const controllerPath = path.join(root, 'mysql/controllers/events.js');

function loadController(execute) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];
  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => ({ execute }),
  };
  return require(controllerPath);
}

function mockRes() {
  const res = {};
  res.status = (code) => { res._code = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

const body = { event_id: 701, staff_id: 207, role: 'Administrator' };

test('insertingStaffInEvent: 201 cuando el INSERT funciona', async () => {
  const { insertingStaffInEvent } = loadController(async () => [{ insertId: 1 }]);
  const res = mockRes();
  await insertingStaffInEvent({ body }, res);
  assert.equal(res._code, 201);
  assert.equal(res._body.ok, true);
});

test('insertingStaffInEvent: responde 409 en ER_DUP_ENTRY en vez de colgarse', async () => {
  const { insertingStaffInEvent } = loadController(async () => {
    throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
  });
  const res = mockRes();
  await insertingStaffInEvent({ body }, res);
  assert.equal(res._code, 409);
  assert.equal(res._body.ok, false);
});

test('insertingStaffInEvent: responde 500 con el mensaje en cualquier otro error', async () => {
  const { insertingStaffInEvent } = loadController(async () => {
    throw Object.assign(new Error('Cannot add or update a child row'), { code: 'ER_NO_REFERENCED_ROW_2' });
  });
  const res = mockRes();
  await insertingStaffInEvent({ body }, res);
  assert.equal(res._code, 500);
  assert.match(res._body.msg, /child row/);
});

test('deleteEvent: responde 500 con el mensaje en vez de colgarse', async () => {
  const { deleteEvent } = loadController(async () => {
    throw new Error('Bind parameters must not contain undefined');
  });
  const res = mockRes();
  await deleteEvent({ body: {}, params: { id: '701' } }, res);
  assert.equal(res._code, 500);
  assert.equal(res._body.ok, false);
});
