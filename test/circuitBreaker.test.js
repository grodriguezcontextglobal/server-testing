'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Circuit breaker genérico (no específico de Go worker) para envolver llamadas
// a servicios externos inestables. Estados: closed (normal) -> open (falla
// rápido, sin llamar a fn) -> half-open (prueba un intento tras el cooldown).
// `now` se inyecta para tests deterministas (mismo patrón que queue/core.js).
const { createCircuitBreaker } = require('../helpers/circuitBreaker');

test('createCircuitBreaker: closed — llama a fn normalmente y devuelve su resultado', async () => {
  const breaker = createCircuitBreaker(async (x) => x * 2);
  assert.equal(await breaker(21), 42);
});

test('createCircuitBreaker: un éxito resetea el contador de fallos consecutivos', async () => {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    if (calls <= 2) throw new Error('boom');
    return 'ok';
  };
  const breaker = createCircuitBreaker(fn, { failureThreshold: 3 });

  await assert.rejects(() => breaker());
  await assert.rejects(() => breaker());
  assert.equal(await breaker(), 'ok'); // 3er intento: éxito antes de llegar al threshold
  assert.equal(breaker.getState(), 'closed');
});

test('createCircuitBreaker: tras failureThreshold fallos consecutivos, se abre', async () => {
  const fn = async () => { throw new Error('boom'); };
  const breaker = createCircuitBreaker(fn, { failureThreshold: 3 });

  await assert.rejects(() => breaker());
  await assert.rejects(() => breaker());
  assert.equal(breaker.getState(), 'closed'); // aún no llegó al threshold
  await assert.rejects(() => breaker());
  assert.equal(breaker.getState(), 'open');
});

test('createCircuitBreaker: abierto y dentro del cooldown, falla rápido SIN llamar a fn', async () => {
  let calls = 0;
  const fn = async () => { calls += 1; throw new Error('boom'); };
  let currentTime = 1000;
  const breaker = createCircuitBreaker(fn, { failureThreshold: 1, cooldownMs: 5000, now: () => currentTime });

  await assert.rejects(() => breaker()); // 1er fallo -> abre
  assert.equal(breaker.getState(), 'open');
  assert.equal(calls, 1);

  currentTime += 1000; // todavía dentro del cooldown (5000ms)
  await assert.rejects(() => breaker(), /Circuit breaker is open/);
  assert.equal(calls, 1); // fn NO se volvió a llamar
});

test('createCircuitBreaker: pasado el cooldown, entra en half-open y reintenta fn', async () => {
  let calls = 0;
  const fn = async () => { calls += 1; if (calls === 1) throw new Error('boom'); return 'recovered'; };
  let currentTime = 1000;
  const breaker = createCircuitBreaker(fn, { failureThreshold: 1, cooldownMs: 5000, now: () => currentTime });

  await assert.rejects(() => breaker()); // abre
  currentTime += 6000; // pasó el cooldown

  const result = await breaker(); // half-open: reintenta, esta vez fn tiene éxito
  assert.equal(result, 'recovered');
  assert.equal(breaker.getState(), 'closed');
  assert.equal(calls, 2);
});

test('createCircuitBreaker: si el intento en half-open vuelve a fallar, reabre y reinicia el cooldown', async () => {
  const fn = async () => { throw new Error('sigue caído'); };
  let currentTime = 1000;
  const breaker = createCircuitBreaker(fn, { failureThreshold: 1, cooldownMs: 5000, now: () => currentTime });

  await assert.rejects(() => breaker()); // abre en t=1000
  currentTime += 6000; // t=7000, pasó el cooldown
  await assert.rejects(() => breaker()); // half-open falla -> reabre en t=7000
  assert.equal(breaker.getState(), 'open');

  currentTime += 1000; // t=8000, NO pasaron otros 5000ms desde el reabierto (7000)
  await assert.rejects(() => breaker(), /Circuit breaker is open/);
});

// ─── isFailure: distinguir fallos que cuentan vs errores de negocio ──────────
// Un error de negocio (ej. tarjeta rechazada en Stripe) es una respuesta
// EXITOSA del servicio — prueba que está sano. No debe contar para abrir el
// circuito, y de hecho debe resetear el contador como un éxito. Pero igual se
// re-lanza para que el caller responda lo correcto.

test('createCircuitBreaker: un error que isFailure marca como NO-fallo se re-lanza pero no abre el circuito', async () => {
  const businessError = Object.assign(new Error('card declined'), { kind: 'business' });
  const fn = async () => { throw businessError; };
  const breaker = createCircuitBreaker(fn, {
    failureThreshold: 1,
    isFailure: (err) => err.kind !== 'business',
  });

  await assert.rejects(() => breaker(), /card declined/); // se re-lanza
  assert.equal(breaker.getState(), 'closed'); // NO abrió pese a failureThreshold=1
});

test('createCircuitBreaker: un error de negocio resetea el contador de fallos de infra', async () => {
  let mode = 'infra';
  const fn = async () => {
    if (mode === 'infra') throw Object.assign(new Error('timeout'), { kind: 'infra' });
    throw Object.assign(new Error('declined'), { kind: 'business' });
  };
  const breaker = createCircuitBreaker(fn, {
    failureThreshold: 3,
    isFailure: (err) => err.kind !== 'business',
  });

  await assert.rejects(() => breaker()); // 1 fallo infra
  await assert.rejects(() => breaker()); // 2 fallos infra
  mode = 'business';
  await assert.rejects(() => breaker()); // error de negocio -> resetea contador
  mode = 'infra';
  await assert.rejects(() => breaker()); // vuelve a 1 fallo infra (no 3)
  assert.equal(breaker.getState(), 'closed'); // no llegó al threshold de 3
});

test('createCircuitBreaker: sin isFailure, todo error cuenta (comportamiento por defecto intacto)', async () => {
  const fn = async () => { throw new Error('boom'); };
  const breaker = createCircuitBreaker(fn, { failureThreshold: 2 });

  await assert.rejects(() => breaker());
  await assert.rejects(() => breaker());
  assert.equal(breaker.getState(), 'open');
});
