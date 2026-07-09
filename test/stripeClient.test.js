'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Endurecimiento de Stripe (Fase 3, DESIGN_task_queue.md): las mutaciones NO se
// encolan (el dinero no se buffea) — se endurecen con:
//  - retry idempotente: maxNetworkRetries del SDK (agrega idempotency keys solo,
//    no testeable acá porque es config del constructor — se verifica en el smoke).
//  - circuit breaker COMPARTIDO por todas las mutaciones, que solo cuenta fallos
//    de infraestructura de Stripe, no errores de negocio (tarjeta rechazada, etc).
const { isStripeInfraFailure, createRunStripeMutation } = require('../helpers/stripeClient');

// ─── isStripeInfraFailure: qué errores de Stripe abren el circuito ───────────

test('isStripeInfraFailure: api_connection_error cuenta como fallo de infra', () => {
  assert.equal(isStripeInfraFailure({ type: 'api_connection_error' }), true);
});

test('isStripeInfraFailure: api_error (error interno de Stripe) cuenta', () => {
  assert.equal(isStripeInfraFailure({ type: 'api_error' }), true);
});

test('isStripeInfraFailure: rate_limit_error cuenta (conviene hacer back-off)', () => {
  assert.equal(isStripeInfraFailure({ type: 'rate_limit_error' }), true);
});

test('isStripeInfraFailure: card_error (tarjeta rechazada) NO cuenta — es negocio', () => {
  assert.equal(isStripeInfraFailure({ type: 'card_error' }), false);
});

test('isStripeInfraFailure: invalid_request_error NO cuenta — es error del cliente', () => {
  assert.equal(isStripeInfraFailure({ type: 'invalid_request_error' }), false);
});

test('isStripeInfraFailure: idempotency_error NO cuenta', () => {
  assert.equal(isStripeInfraFailure({ type: 'idempotency_error' }), false);
});

test('isStripeInfraFailure: un error genérico sin type (ej. timeout de red crudo) cuenta como infra', () => {
  assert.equal(isStripeInfraFailure(new Error('socket hang up')), true);
});

// ─── createRunStripeMutation: envuelve un thunk con el breaker compartido ────

test('createRunStripeMutation: en éxito, devuelve el resultado del thunk', async () => {
  const breaker = (fn) => fn();
  const runStripeMutation = createRunStripeMutation(breaker);
  const result = await runStripeMutation(() => Promise.resolve({ id: 'pi_1', status: 'succeeded' }));
  assert.deepEqual(result, { id: 'pi_1', status: 'succeeded' });
});

test('createRunStripeMutation: propaga el error del thunk (para que el controller lo maneje)', async () => {
  const breaker = (fn) => fn();
  const runStripeMutation = createRunStripeMutation(breaker);
  await assert.rejects(
    () => runStripeMutation(() => Promise.reject(Object.assign(new Error('declined'), { type: 'card_error' }))),
    /declined/
  );
});

test('createRunStripeMutation: pasa el thunk al breaker (no lo invoca directo)', async () => {
  let breakerCalledWith = null;
  const breaker = (fn) => { breakerCalledWith = fn; return fn(); };
  const runStripeMutation = createRunStripeMutation(breaker);
  const thunk = () => Promise.resolve('ok');
  await runStripeMutation(thunk);
  assert.equal(breakerCalledWith, thunk);
});
