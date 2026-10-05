'use strict';

/**
 * middlewares/auditTrail.js sobre una app Express real (puerto aleatorio): así
 * el matching de rutas, baseUrl y el evento `finish` son los de verdad.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createAuditTrail, sanitize } = require('../middlewares/auditTrail');

const STAFF = '64b7f0c2a1b2c3d4e5f60718';
const token = jwt.sign({ uid: STAFF, tokenVersion: 0 }, process.env.SECRET_JWT_SEED);

const REGISTRY = {
  'POST /api/receiver/receiver-assignation': { action: 'ASSIGN', target_model: 'Device' },
  'POST /api/db_item/new_item': { action: 'CREATE', target_model: 'Inventory' },
  'DELETE /api/db_shipment/:shipment_id': { action: 'DELETE', target_model: 'Shipment' },
  'POST /api/db_shipment': { action: 'CREATE', target_model: 'Shipment' },
  'POST /api/fails': { action: 'UPDATE', target_model: 'Inventory' },
};

let logged;
let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(createAuditTrail({ registry: REGISTRY, logFn: async (e) => { logged.push(e); } }));

  const receiver = express.Router();
  receiver.post('/receiver-assignation', (req, res) => res.status(201).json({ ok: true }));
  receiver.post('/receiver-assigned-list', (req, res) => res.json({ ok: true })); // consulta: no auditada
  app.use('/api/receiver', receiver);

  const item = express.Router();
  item.post('/new_item', (req, res) => res.status(201).json({ ok: true, insertId: 4567 }));
  app.use('/api/db_item', item);

  const shipment = express.Router();
  shipment.post('/', (req, res) => res.status(201).json({ ok: true }));
  shipment.delete('/:shipment_id', (req, res) => res.json({ ok: true }));
  app.use('/api/db_shipment', shipment);

  app.post('/api/fails', (req, res) => res.status(422).json({ ok: false }));

  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => { logged = []; });

const call = async (method, path, { body, headers = {} } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await res.text();
  // `finish` corre al terminar de escribir; se da un tick para que el log entre.
  await new Promise((r) => setImmediate(r));
  return res.status;
};

test('asignar un dispositivo a un consumidor: autor del x-token, evento, seriales y cuántos', async () => {
  const status = await call('POST', '/api/receiver/receiver-assignation', {
    headers: { 'x-token': token, 'x-company-id': 'aaaaaaaaaaaaaaaaaaaaaaaa' },
    body: {
      event_id: 701,
      consumer: 'ana@x.com',
      devices: [{ serial_number: 'SN-1' }, { serial_number: 'SN-2' }],
    },
  });
  assert.equal(status, 201);
  assert.equal(logged.length, 1);
  const e = logged[0];
  assert.equal(e.staff_member_id, STAFF);
  assert.equal(e.actor_type, 'staff');
  assert.equal(e.action, 'ASSIGN');
  assert.equal(e.target_model, 'Device');
  assert.equal(e.company_id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(e.context.event_id, '701');
  assert.equal(e.context.consumer, 'ana@x.com');
  assert.deepEqual(e.context.serial_numbers, ['SN-1', 'SN-2']);
  assert.equal(e.context.count, 2);
  assert.equal(e.details.route, 'POST /api/receiver/receiver-assignation');
  assert.equal(e.source, 'server');
});

test('una consulta por POST que no está en la lista no se registra', async () => {
  await call('POST', '/api/receiver/receiver-assigned-list', { headers: { 'x-token': token }, body: {} });
  assert.equal(logged.length, 0);
});

test('una respuesta de error no se registra', async () => {
  const status = await call('POST', '/api/fails', { headers: { 'x-token': token }, body: {} });
  assert.equal(status, 422);
  assert.equal(logged.length, 0);
});

test('sin token, o con uno inválido, la acción se registra como anónima', async () => {
  await call('POST', '/api/receiver/receiver-assignation', { body: { event_id: 1 } });
  await call('POST', '/api/receiver/receiver-assignation', { headers: { 'x-token': 'basura' }, body: { event_id: 1 } });
  assert.equal(logged.length, 2);
  for (const e of logged) {
    assert.equal(e.staff_member_id, null);
    assert.equal(e.actor_type, 'anonymous');
  }
});

test('el id del objeto creado sale de la respuesta (insertId); la compañía SQL del header', async () => {
  await call('POST', '/api/db_item/new_item', {
    headers: { 'x-token': token, 's-company-lq': '137' },
    body: { serial_number: 'X-9', item_group: 'iPad' },
  });
  const e = logged[0];
  assert.equal(e.target_id, '4567');
  assert.equal(e.company_sql_id, '137');
  assert.deepEqual(e.context.serial_numbers, ['X-9']);
});

test('el id del objeto sale de la URL, y una ruta montada en "/" casa con su base', async () => {
  await call('DELETE', '/api/db_shipment/88', { headers: { 'x-token': token } });
  await call('POST', '/api/db_shipment', { headers: { 'x-token': token }, body: {} });
  assert.equal(logged[0].target_id, '88');
  assert.equal(logged[0].action, 'DELETE');
  assert.equal(logged[1].details.route, 'POST /api/db_shipment');
});

test('el body guardado no lleva secretos', async () => {
  await call('POST', '/api/receiver/receiver-assignation', {
    headers: { 'x-token': token },
    body: { event_id: 1, password: 'x', card: { number: '4242' }, otc: '123', note: 'ok' },
  });
  const req = logged[0].details.request;
  assert.equal(req.password, '[redacted]');
  assert.equal(req.card, '[redacted]');
  assert.equal(req.otc, '[redacted]');
  assert.equal(req.note, 'ok');
});

test('sanitize recorta listas largas y textos largos', () => {
  const out = sanitize({ list: Array.from({ length: 50 }, (_, i) => i), text: 'a'.repeat(1000) });
  assert.equal(out.list.length, 21);
  assert.match(out.list[20], /\+30 more/);
  assert.ok(out.text.length < 400);
});

test('si escribir el log falla, la respuesta al cliente no se entera', async () => {
  const app = express();
  app.use(express.json());
  app.use(createAuditTrail({ registry: REGISTRY, logFn: async () => { throw new Error('queue down'); } }));
  app.post('/api/db_shipment', (req, res) => res.status(201).json({ ok: true }));
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/db_shipment`, { method: 'POST' });
  assert.equal(res.status, 201);
  await new Promise((r) => srv.close(r));
});
