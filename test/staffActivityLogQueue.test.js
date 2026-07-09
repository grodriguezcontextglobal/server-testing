'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// logStaffActivity es una función INTERNA (no un endpoint HTTP) llamada desde
// controller/admin.js, controller/event.js y controller/inventory.js vía
// `await logStaffActivity({...})`. Hoy nunca lanza ni devuelve nada: si el save
// falla, el error se traga en un try/catch y el log se pierde para siempre en
// silencio (bug preexistente). Migrar a enqueue() preserva ese mismo contrato
// para los callers (nunca lanza) pero cambia la pérdida silenciosa por
// reintento + dead-letter. Ver DESIGN_task_queue.md § Fase 1.
const { logStaffActivity } = require('../controller/staffActivityLog');

test('logStaffActivity: encola el dato tal cual bajo type log:staff-activity', async () => {
  const calls = [];
  const fakeEnqueue = async (type, payload, opts) => { calls.push({ type, payload, opts }); return { id: 'JOB1' }; };

  const data = { staff_member_id: 'S1', company_id: 'C1', action: 'LOGIN' };
  await logStaffActivity(data, { enqueueFn: fakeEnqueue });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'log:staff-activity');
  assert.deepEqual(calls[0].payload, data);
});

test('logStaffActivity: nunca lanza, incluso si enqueue falla (preserva el contrato actual)', async () => {
  const fakeEnqueue = async () => { throw new Error('Mongo down'); };
  await assert.doesNotReject(() => logStaffActivity({ staff_member_id: 'S1' }, { enqueueFn: fakeEnqueue }));
});

test('logStaffActivity: sin opts, usa el enqueue real por defecto (no rompe callers existentes)', () => {
  // No se invoca (evitaríamos tocar Mongo real); solo se verifica que la firma
  // sigue aceptando un único argumento, como usan los 12 call-sites actuales.
  assert.equal(logStaffActivity.length, 1);
});
