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
  'PATCH /api/receiver/receiver-update/:id': { action: 'UPDATE', target_model: 'Device' },
  'POST /api/stripe/account_sessions': { action: 'OPEN', target_model: 'StripeAccount' },
  'PATCH /api/db_staff/company-staff': { action: 'UPDATE', target_model: 'Staff' },
  'PATCH /api/company/update-company/:id': { action: 'UPDATE', target_model: 'Company' },
};

let logged;
let server;
let base;
// Memoria de compañía en memoria (en producción, Redis).
let remembered;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(createAuditTrail({
    registry: REGISTRY,
    readOnly: new Set(['POST /api/receiver/receiver-assigned-list']),
    loggedElsewhere: new Set(['POST /api/event/create-event']),
    logFn: async (e) => { logged.push(e); },
    rememberCompany: async (uid, companyId) => { remembered.set(String(uid), companyId); },
    recallCompany: async (uid) => remembered.get(String(uid)) ?? null,
  }));

  // Simula una ruta protegida por authorizeMongoPermission: deja req.uid y
  // req.isSuperUser, que es la marca de "membresía verificada".
  app.get('/api/admin/activity-logs', (req, res) => {
    req.uid = STAFF;
    req.isSuperUser = false;
    res.json({ ok: true });
  });
  // Misma cabecera, pero sin pasar por la verificación de membresía.
  app.get('/api/unverified', (req, res) => {
    req.uid = STAFF;
    res.json({ ok: true });
  });

  const receiver = express.Router();
  receiver.post('/receiver-assignation', (req, res) => res.status(201).json({ ok: true }));
  receiver.post('/receiver-assigned-list', (req, res) => res.json({ ok: true })); // consulta: no auditada
  // Como en producción: la respuesta trae el consumidor (`user`), el request no.
  receiver.patch('/receiver-update/:id', (req, res) =>
    res.status(201).json({ ok: true, id: req.params.id, user: 'ana@x.com', device: req.body.device }));
  app.use('/api/receiver', receiver);

  const stripe = express.Router();
  stripe.post('/account_sessions', (req, res) => res.status(201).json({ client_secret: 'x' }));
  app.use('/api/stripe', stripe);

  const sqlStaff = express.Router();
  sqlStaff.patch('/company-staff', (req, res) => res.json({ ok: true }));
  app.use('/api/db_staff', sqlStaff);

  const company = express.Router();
  company.patch('/update-company/:id', (req, res) => res.json({ ok: true }));
  app.use('/api/company', company);

  // Una escritura que nadie clasificó: tiene que registrarse igual.
  const mailer = express.Router();
  mailer.post('/brand-new-notification', (req, res) => res.status(202).json({ ok: true }));
  app.use('/api/nodemailer', mailer);

  app.post('/api/event/create-event', (req, res) => res.status(201).json({ ok: true }));

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
beforeEach(() => { logged = []; remembered = new Map(); });

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

test('el payload real del dashboard al asignar (DeviceAssigned.render): serial anidado, evento y consumidor', async () => {
  await call('POST', '/api/receiver/receiver-assignation', {
    headers: { 'x-token': token },
    body: {
      paymentIntent: 'pi_123',
      device: { serialNumber: 'RX-0042', deviceType: 'Receiver', status: true },
      user: 'ana@x.com',
      active: true,
      eventSelected: 'Feria 2026',
      provider: 'Acme',
      company: 'Acme',
      event_id: 701,
    },
  });
  const ctx = logged[0].context;
  assert.deepEqual(ctx.serial_numbers, ['RX-0042']);
  assert.equal(ctx.event_id, '701');
  assert.equal(ctx.event_name, 'Feria 2026');
  assert.equal(ctx.consumer, 'ana@x.com');
});

// ── El caso reportado: devolver un dispositivo desde el consumidor del evento ──
// Las rutas /api/receiver no llevan cabecera de compañía. Antes, un usuario de
// varias compañías dejaba la acción con company_id null y el reporte (filtrado
// por compañía) no la mostraba.

test('una acción sin cabecera de compañía toma la última compañía VERIFICADA del autor', async () => {
  const CO = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  // 1) El usuario abre algo protegido por authorizeMongoPermission con su compañía.
  await call('GET', '/api/admin/activity-logs', { headers: { 'x-token': token, 'x-company-id': CO } });
  // 2) Devuelve un dispositivo: la ruta no manda compañía.
  await call('POST', '/api/receiver/receiver-assignation', {
    headers: { 'x-token': token },
    body: { device: { serialNumber: 'RX-1' }, event_id: 701 },
  });
  const e = logged.at(-1);
  assert.equal(e.company_id, CO);
  assert.equal(e.details.company_source, 'last_seen');
});

test('una cabecera de compañía sin membresía verificada NO se recuerda', async () => {
  await call('GET', '/api/unverified', {
    headers: { 'x-token': token, 'x-company-id': 'bbbbbbbbbbbbbbbbbbbbbbbb' },
  });
  assert.equal(remembered.size, 0);
  await call('POST', '/api/receiver/receiver-assignation', { headers: { 'x-token': token }, body: {} });
  assert.equal(logged.at(-1).company_id, null);
});

test('la cabecera explícita de la petición gana a la compañía recordada', async () => {
  remembered.set(STAFF, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  await call('POST', '/api/receiver/receiver-assignation', {
    headers: { 'x-token': token, 'x-company-id': 'cccccccccccccccccccccccc' },
    body: {},
  });
  const e = logged.at(-1);
  assert.equal(e.company_id, 'cccccccccccccccccccccccc');
  assert.equal(e.details.company_source, undefined);
});

test('una consulta por POST que no está en la lista no se registra', async () => {
  await call('POST', '/api/receiver/receiver-assigned-list', { headers: { 'x-token': token }, body: {} });
  assert.equal(logged.length, 0);
});

test('una escritura que no está en ninguna lista se registra igual, con verbo inferido y destinatarios', async () => {
  await call('POST', '/api/nodemailer/brand-new-notification', {
    headers: { 'x-token': token },
    body: { consumer: { email: 'Ana@X.com', name: 'Ana' }, to: ['b@y.com'], subject: 'Hola' },
  });
  assert.equal(logged.length, 1);
  const e = logged[0];
  assert.equal(e.action, 'SEND');
  assert.equal(e.details.inferred, true);
  assert.deepEqual(e.context.recipients.sort(), ['ana@x.com', 'b@y.com']);
});

test('lo que ya registra su controlador no se duplica', async () => {
  await call('POST', '/api/event/create-event', { headers: { 'x-token': token }, body: {} });
  assert.equal(logged.length, 0);
});

test('una ruta que no existe (404) no se registra', async () => {
  const status = await call('POST', '/api/nope/never', { headers: { 'x-token': token }, body: {} });
  assert.equal(status, 404);
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

test('el consumidor sale de la respuesta cuando el request no lo trae (receiver-update)', async () => {
  await call('PATCH', '/api/receiver/receiver-update/R1', {
    headers: { 'x-token': token },
    body: { id: 'R1', device: { serialNumber: 'SN-100006', status: false } },
  });
  const e = logged.at(-1);
  assert.equal(e.target_id, 'R1');
  assert.equal(e.context.consumer, 'ana@x.com');
  assert.deepEqual(e.context.serial_numbers, ['SN-100006']);
});

test('el id del objeto sale del body si no está en la URL ni en la respuesta (el caso de Stripe)', async () => {
  await call('POST', '/api/stripe/account_sessions', {
    headers: { 'x-token': token },
    body: { connectedAccountId: 'acct_1U3wd6JNGnMoHT28' },
  });
  assert.equal(logged.at(-1).target_id, 'acct_1U3wd6JNGnMoHT28');
});

test('una acción sobre un staff member lo identifica (staff_id y email del body)', async () => {
  await call('PATCH', '/api/db_staff/company-staff', {
    headers: { 'x-token': token },
    body: { staff_id: 207, email: 'bob@x.com', company_id: 137, role: 'admin' },
  });
  const e = logged.at(-1);
  assert.equal(e.target_id, '207');
  assert.equal(e.target_label, 'bob@x.com');
});

test('un array cualquiera del body no se cuenta como "N objetos" (Updated 2 companies)', async () => {
  await call('PATCH', '/api/company/update-company/C1', {
    headers: { 'x-token': token },
    body: { company_name: 'Acme', employees: [{ user: 'a@x.com' }, { user: 'b@x.com' }] },
  });
  assert.equal(logged.at(-1).context.count, undefined);
});

test('la IP es la del cliente (x-forwarded-for), no la del proxy, y sin puerto', async () => {
  await call('POST', '/api/db_shipment', {
    headers: { 'x-token': token, 'x-forwarded-for': '200.10.20.30:51234, 172.16.40.2' },
    body: {},
  });
  assert.equal(logged.at(-1).ip_address, '200.10.20.30');
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
  app.use(createAuditTrail({
    registry: REGISTRY,
    logFn: async () => { throw new Error('queue down'); },
    rememberCompany: async () => {},
    recallCompany: async () => null,
  }));
  app.post('/api/db_shipment', (req, res) => res.status(201).json({ ok: true }));
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/db_shipment`, { method: 'POST' });
  assert.equal(res.status, 201);
  await new Promise((r) => srv.close(r));
});
