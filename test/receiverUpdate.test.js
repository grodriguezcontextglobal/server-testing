'use strict';

/**
 * PATCH/PUT /api/receiver/receiver-update/:id (2026-10-22).
 *
 *   - El id sale de la URL (antes solo del body: 500 "id is required").
 *   - Solo se aplica lo que viene (device, active): un `{ active: false }` no
 *     pisa el device con undefined.
 *   - Receiver inexistente → 404 (antes, TypeError y 500).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const updates = [];
let found = true;
const filename = path.join(root, 'models/Receivers.js');
require.cache[filename] = {
  id: filename, filename, loaded: true,
  exports: {
    findByIdAndUpdate: async (id, update) => {
      updates.push({ id, update });
      return found ? { _id: id, user: 'a@x.com', paymentIntent: 'pi_1', device: { status: true }, ...update.$set } : null;
    },
  },
};

const { udpateReceiverStatus } = require('../controller/receiver');

const res = () => ({ status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const call = async (params, body) => { const r = res(); await udpateReceiverStatus({ params, body }, r); return r; };

test.beforeEach(() => { updates.length = 0; found = true; });

test('el id de la URL basta; { active: false } solo cambia active', async () => {
  const r = await call({ id: 'R1' }, { active: false });
  assert.equal(r.code, 201);
  assert.deepEqual(updates[0], { id: 'R1', update: { $set: { active: false } } });
});

test('como antes: { id, device } en el body sigue funcionando', async () => {
  const r = await call({ id: 'R1' }, { id: 'R1', device: { status: false } });
  assert.equal(r.code, 201);
  assert.deepEqual(updates[0].update, { $set: { device: { status: false } } });
});

test('el body entero (Cash.jsx) solo aplica device y active', async () => {
  await call({ id: 'R1' }, { id: 'R1', user: 'x', paymentIntent: 'pi_x', device: { status: false }, active: true });
  assert.deepEqual(updates[0].update, { $set: { device: { status: false }, active: true } });
});

test('sin nada que cambiar → 500 con mensaje claro, sin escribir', async () => {
  const r = await call({ id: 'R1' }, {});
  assert.equal(r.code, 500);
  assert.match(r.body.msg, /device or active/);
  assert.equal(updates.length, 0);
});

test('receiver inexistente → 404', async () => {
  found = false;
  const r = await call({ id: 'R404' }, { active: false });
  assert.equal(r.code, 404);
});
