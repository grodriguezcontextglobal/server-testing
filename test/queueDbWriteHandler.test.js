'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Handler genérico de la cola para escrituras simples a Mongo (logs). createFn
// se inyecta (igual que sendFn en queue/handlers/email.js) para no tocar
// Mongoose/DB real en el test.
const { createModelInsertHandler } = require('../queue/handlers/dbWrite');

test('createModelInsertHandler: inserta el payload vía createFn y devuelve su id', async () => {
  const calls = [];
  const createFn = async (payload) => { calls.push(payload); return { id: 'DOC1', toJSON: () => ({ id: 'DOC1', ...payload }) }; };
  const handler = createModelInsertHandler(createFn);

  const payload = { user: 'U1', action: 'LOGIN' };
  const result = await handler(payload);

  assert.deepEqual(calls, [payload]);
  assert.deepEqual(result, { id: 'DOC1' });
});

test('createModelInsertHandler: propaga el error de createFn (para que el worker reintente)', async () => {
  const createFn = async () => { throw new Error('Mongo validation failed'); };
  const handler = createModelInsertHandler(createFn);

  await assert.rejects(() => handler({ user: 'U1' }), /Mongo validation failed/);
});
