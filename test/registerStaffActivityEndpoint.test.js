'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createRegisterStaffActivity } = require('../controller/staffActivityLog');

function makeRes() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('registerStaffActivity: 400 cuando falta action o target_model', async () => {
  const handler = createRegisterStaffActivity();
  const req = { uid: 'S1', body: { target_model: 'Inventory' }, headers: {} };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('registerStaffActivity: 404 cuando el staff member no existe', async () => {
  const handler = createRegisterStaffActivity({
    findAdminUserFn: async () => null,
  });
  const req = { uid: 'S1', body: { action: 'CREATE', target_model: 'Inventory' }, headers: {} };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 404);
});

test('registerStaffActivity: staff_member_id del JWT y company_id del header, nunca del body', async () => {
  const logged = [];
  const handler = createRegisterStaffActivity({
    findAdminUserFn: async (id) => (id === 'S1' ? { id: 'S1' } : null),
    logStaffActivityFn: async (data) => { logged.push(data); },
  });
  const req = {
    uid: 'S1',
    body: {
      action: 'CREATE',
      target_model: 'Inventory',
      target_id: 'ITEM1',
      details: { note: 'added item' },
      staff_member_id: 'SPOOFED',
      company_id: 'SPOOFED_COMPANY',
    },
    headers: { 'user-agent': 'jest', 'x-company-id': 'C1' },
    ip: '127.0.0.1',
  };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].staff_member_id, 'S1');
  assert.equal(logged[0].company_id, 'C1');
  assert.equal(logged[0].action, 'CREATE');
  assert.equal(logged[0].target_model, 'Inventory');
  assert.equal(logged[0].target_id, 'ITEM1');
  assert.deepEqual(logged[0].details, { note: 'added item' });
  assert.equal(logged[0].ip_address, '127.0.0.1');
  assert.equal(logged[0].device_info, 'jest');
});

test('registerStaffActivity: sin contexto de compañía registra company_id null, no el del body', async () => {
  const logged = [];
  const handler = createRegisterStaffActivity({
    findAdminUserFn: async () => ({ id: 'S1' }),
    logStaffActivityFn: async (data) => { logged.push(data); },
  });
  const req = {
    uid: 'S1',
    body: { action: 'CREATE', target_model: 'Inventory', company_id: 'SPOOFED_COMPANY' },
    headers: {},
  };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 202);
  assert.equal(logged[0].company_id, null);
});

test('registerStaffActivity: 500 si logStaffActivityFn lanza', async () => {
  const handler = createRegisterStaffActivity({
    findAdminUserFn: async () => ({ id: 'S1' }),
    logStaffActivityFn: async () => { throw new Error('boom'); },
  });
  const req = { uid: 'S1', body: { action: 'CREATE', target_model: 'Inventory' }, headers: {} };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
});
